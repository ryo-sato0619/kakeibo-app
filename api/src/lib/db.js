'use strict';

/**
 * Azure SQL Database 接続（mssql）。
 *  - 接続プールはモジュールスコープで 1 回だけ生成し、関数呼び出しごとに作り直さない。
 *  - サーバーレス DB の一時停止からの復帰中（40613 など）は指数バックオフで最大 5 回リトライし、
 *    それでもだめなら 503（DB_UNAVAILABLE）を返す。
 *  - 更新系クエリは二重実行を避けるため再実行しない（接続の確立だけをリトライする）。
 *  - mssql は実際に接続するときまで読み込まない（テストを DB なしで動かすため）。
 */

const { ApiError, dbUnavailable } = require('./errors');

// ---- 一時的なエラーの判定 ---------------------------------------------------

const TRANSIENT_NUMBERS = new Set([
  40613, // データベースが現在利用できない（一時停止からの復帰中など）
  40197, // サービスがリクエストを処理中にエラー
  40501, // サービスがビジー
  49918, 49919, 49920, // リソース不足 / 処理中の操作が多すぎる
  10928, 10929, // リソース制限
  10053, 10054, 10060, // 接続の切断・タイムアウト
  233, // 接続が閉じられた
]);
const TRANSIENT_CODES = new Set(['ETIMEOUT', 'ESOCKET', 'ECONNRESET', 'ECONNCLOSED', 'ETIMEDOUT']);
const TRANSIENT_MESSAGE = /not currently available|\b(40613|40197|40501|49918|49919|49920)\b/i;

function errorNumber(err) {
  const candidates = [
    err.number,
    err.originalError && err.originalError.number,
    err.originalError && err.originalError.info && err.originalError.info.number,
    err.precedingErrors && err.precedingErrors[0] && err.precedingErrors[0].number,
  ];
  return candidates.find((n) => typeof n === 'number');
}

/** リトライすれば回復しうる一時的なエラーか */
function isTransient(err) {
  if (!err || err instanceof ApiError) return false;
  const n = errorNumber(err);
  if (n !== undefined && TRANSIENT_NUMBERS.has(n)) return true;
  if (err.code && TRANSIENT_CODES.has(err.code)) return true;
  return TRANSIENT_MESSAGE.test(String(err.message || ''));
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 一時的なエラーのときだけ、指数バックオフ（1s, 2s, 4s, 8s, 16s）で再試行する。
 * retries 回リトライしても失敗したら 503 を投げる。一時的でないエラーはそのまま投げる。
 *
 * SWA のマネージド Functions は 1 リクエスト最大 45 秒のため、待ち時間を含む経過時間が
 * maxTotalMs（既定 38 秒）を超えそうなときは、リトライ回数が残っていても早めに 503 を返す。
 * （画面側が 503 を受けて自動で再試行する）
 */
async function withRetry(fn, options = {}) {
  const { retries = 5, baseDelayMs = 1000, sleep = defaultSleep, now = Date.now, maxTotalMs = 38000 } = options;
  const startedAt = now();
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (!isTransient(err)) throw err;
      const delay = baseDelayMs * 2 ** attempt;
      if (attempt >= retries || now() - startedAt + delay > maxTotalMs) throw dbUnavailable();
      await sleep(delay);
      attempt += 1;
    }
  }
}

// ---- 接続文字列 -----------------------------------------------------------

function splitConnectionString(text) {
  const parts = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        if (text[i + 1] === quote) {
          cur += ch; // 引用符の二重化はエスケープ
          i += 1;
        } else {
          quote = null;
        }
      } else {
        cur += ch;
      }
    } else if ((ch === '"' || ch === "'") && cur.trimEnd().endsWith('=')) {
      quote = ch; // 値の先頭の引用符だけを引用開始とみなす
    } else if (ch === ';') {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts.filter((p) => p.trim() !== '');
}

const toBool = (v) => /^(true|yes|mandatory|strict|1)$/i.test(String(v).trim());

/**
 * ADO.NET 形式の接続文字列（Azure ポータルが表示する形式）を mssql の設定オブジェクトにする。
 *   Server=tcp:xxx.database.windows.net,1433;Database=kakeibo;User Id=...;Password=...;Encrypt=true;
 */
function parseConnectionString(text) {
  const values = {};
  for (const part of splitConnectionString(text)) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).replace(/\s+/g, '').toLowerCase();
    values[key] = part.slice(idx + 1).trim();
  }
  const pick = (...keys) => keys.map((k) => values[k]).find((v) => v !== undefined);

  const serverRaw = pick('server', 'datasource', 'address', 'addr', 'networkaddress');
  const database = pick('database', 'initialcatalog');
  const user = pick('userid', 'uid', 'user');
  const password = pick('password', 'pwd');
  const missing = [];
  if (!serverRaw) missing.push('Server');
  if (!database) missing.push('Database');
  if (!user) missing.push('User Id');
  if (password === undefined) missing.push('Password');
  if (missing.length) {
    throw new Error(`SQL_CONNECTION_STRING の形式が正しくありません（不足: ${missing.join(', ')}）`);
  }

  const [host, portText] = serverRaw.replace(/^tcp:/i, '').split(',');
  const encrypt = pick('encrypt');
  const trust = pick('trustservercertificate');
  const timeoutSec = Number(pick('connectiontimeout', 'connecttimeout', 'timeout'));

  return {
    server: host.trim(),
    port: portText ? Number(portText) : 1433,
    database,
    user,
    password,
    options: {
      encrypt: encrypt === undefined ? true : toBool(encrypt),
      trustServerCertificate: trust === undefined ? false : toBool(trust),
    },
    connectionTimeout: (Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 15) * 1000,
    requestTimeout: 30000,
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
  };
}

// ---- 接続プール管理 -------------------------------------------------------

/** 接続を 1 つだけ保持し、同時要求は同じ接続処理を共有する。reset() で作り直しを許可する。 */
function createPoolManager({ connect }) {
  let pool = null;
  let pending = null;
  return {
    async get() {
      if (pool) return pool;
      if (!pending) {
        pending = connect().then(
          (p) => {
            pool = p;
            pending = null;
            return p;
          },
          (err) => {
            pending = null;
            throw err;
          },
        );
      }
      return pending;
    },
    async reset(failed) {
      if (failed && pool && failed !== pool) return; // 既に新しいプールに置き換わっている
      const old = pool;
      pool = null;
      pending = null;
      if (old && typeof old.close === 'function') {
        try {
          await old.close();
        } catch (_) {
          /* 閉じるのに失敗しても無視 */
        }
      }
    },
  };
}

const sumRowsAffected = (result) => (result.rowsAffected || []).reduce((a, b) => a + b, 0);

/**
 * サービス層が使う DB インターフェース:
 *   query(sql, params)   → レコードの配列
 *   execute(sql, params) → 影響行数
 *   transaction(fn)      → fn に同じインターフェース（tx）を渡し、成功で COMMIT、例外で ROLLBACK
 */
function createDb({ manager, getSql, retryOptions }) {
  const IDEMPOTENT = /^\s*(SELECT|WITH)\b/i;

  function bind(request, params) {
    for (const [name, value] of Object.entries(params || {})) request.input(name, value);
    return request;
  }

  async function recover(err) {
    if (isTransient(err)) await manager.reset();
  }

  async function acquire() {
    return withRetry(async () => {
      try {
        return await manager.get();
      } catch (err) {
        await recover(err);
        throw err;
      }
    }, retryOptions);
  }

  async function run(text, params) {
    if (IDEMPOTENT.test(text)) {
      // 読み取り専用のクエリは、接続エラー時に丸ごとやり直してよい
      return withRetry(async () => {
        try {
          const pool = await manager.get();
          return await bind(pool.request(), params).query(text);
        } catch (err) {
          await recover(err);
          throw err;
        }
      }, retryOptions);
    }
    const pool = await acquire();
    try {
      return await bind(pool.request(), params).query(text);
    } catch (err) {
      await recover(err);
      throw err;
    }
  }

  return {
    async query(text, params) {
      const result = await run(text, params);
      return result.recordset || [];
    },
    async execute(text, params) {
      return sumRowsAffected(await run(text, params));
    },
    async transaction(fn) {
      const sql = getSql();
      const tx = await withRetry(async () => {
        try {
          const pool = await manager.get();
          const t = new sql.Transaction(pool);
          await t.begin();
          return t;
        } catch (err) {
          await recover(err);
          throw err;
        }
      }, retryOptions);

      const txDb = {
        async query(text, params) {
          const result = await bind(tx.request(), params).query(text);
          return result.recordset || [];
        },
        async execute(text, params) {
          return sumRowsAffected(await bind(tx.request(), params).query(text));
        },
        // トランザクションの入れ子は同じトランザクションに参加する
        transaction: (inner) => inner(txDb),
      };

      try {
        const result = await fn(txDb);
        await tx.commit();
        return result;
      } catch (err) {
        try {
          await tx.rollback();
        } catch (_) {
          /* 既に終了している場合は無視 */
        }
        await recover(err);
        throw err;
      }
    },
  };
}

// ---- 本番用のシングルトン -------------------------------------------------

let singleton = null;

/** モジュールスコープで 1 回だけ作る（プールを関数呼び出しごとに作り直さない） */
function getDb() {
  if (singleton) return singleton;
  const manager = createPoolManager({
    async connect() {
      const sql = require('mssql');
      const raw = process.env.SQL_CONNECTION_STRING;
      if (!raw) throw new Error('環境変数 SQL_CONNECTION_STRING が設定されていません');
      const pool = new sql.ConnectionPool(parseConnectionString(raw));
      pool.on('error', () => {
        manager.reset(pool);
      });
      await pool.connect();
      return pool;
    },
  });
  singleton = createDb({ manager, getSql: () => require('mssql') });
  return singleton;
}

module.exports = {
  getDb,
  createDb,
  createPoolManager,
  parseConnectionString,
  isTransient,
  withRetry,
};
