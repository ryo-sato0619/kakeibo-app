'use strict';

const normalize = (sql) => String(sql).replace(/\s+/g, ' ').trim();

/**
 * 単体テスト用の偽 DB。実際の SQL は実行せず、呼ばれた SQL とパラメータを記録する。
 * responder({ kind, sql, params }) が返した値を、query ならレコード配列、execute なら影響行数として返す。
 * transaction() は begin / commit / rollback を calls に記録する。
 */
function createFakeDb(responder = () => []) {
  const calls = [];

  const makeExecutor = () => ({
    async query(sql, params) {
      const call = { kind: 'query', sql: normalize(sql), params };
      calls.push(call);
      const result = await responder(call);
      return Array.isArray(result) ? result : [];
    },
    async execute(sql, params) {
      const call = { kind: 'execute', sql: normalize(sql), params };
      calls.push(call);
      const result = await responder(call);
      return typeof result === 'number' ? result : 1;
    },
  });

  const db = makeExecutor();
  db.transaction = async (fn) => {
    calls.push({ kind: 'begin', sql: '' });
    const tx = makeExecutor();
    tx.transaction = (inner) => inner(tx);
    try {
      const result = await fn(tx);
      calls.push({ kind: 'commit', sql: '' });
      return result;
    } catch (err) {
      calls.push({ kind: 'rollback', sql: '' });
      throw err;
    }
  };
  db.calls = calls;
  db.writes = () => calls.filter((c) => c.kind === 'execute' || (c.kind === 'query' && /^(INSERT|UPDATE|DELETE)/i.test(c.sql)));
  return db;
}

/** [[正規表現 or 部分文字列, 返す値 or 関数], ...] から responder を作る。最初に一致したものを使う。 */
function scripted(rules) {
  return (call) => {
    for (const [pattern, value] of rules) {
      const hit = pattern instanceof RegExp ? pattern.test(call.sql) : call.sql.includes(pattern);
      if (hit) return typeof value === 'function' ? value(call) : value;
    }
    return [];
  };
}

/** Azure Functions の HttpRequest の代わりになる簡易オブジェクト */
function fakeRequest({ method = 'GET', roles = ['owner'], params = {}, query = '', body } = {}) {
  const headers = new Headers();
  if (roles !== null) {
    const principal = Buffer.from(JSON.stringify({ userId: 'u1', userDetails: 'me', userRoles: roles })).toString('base64');
    headers.set('x-ms-client-principal', principal);
  }
  return {
    method,
    headers,
    params,
    query: new URLSearchParams(query),
    json: async () => {
      if (body === undefined) throw new SyntaxError('Unexpected end of JSON input');
      return body;
    },
  };
}

module.exports = { createFakeDb, scripted, fakeRequest, normalize };
