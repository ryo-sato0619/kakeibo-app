'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseConnectionString, isTransient, withRetry, createPoolManager } = require('../src/lib/db');
const { ApiError } = require('../src/lib/errors');

const sqlError = (number, message = 'x') => Object.assign(new Error(message), { number });

describe('接続文字列の解析', () => {
  it('Azure ポータルの形式（tcp: とポート）を読める', () => {
    const c = parseConnectionString(
      'Server=tcp:example-server.database.windows.net,1433;Database=kakeibo;User Id=app_user;Password=abc123;Encrypt=true;',
    );
    assert.equal(c.server, 'example-server.database.windows.net');
    assert.equal(c.port, 1433);
    assert.equal(c.database, 'kakeibo');
    assert.equal(c.user, 'app_user');
    assert.equal(c.password, 'abc123');
    assert.equal(c.options.encrypt, true);
    assert.equal(c.options.trustServerCertificate, false);
  });

  it('ADO.NET の別名キーと Connection Timeout を読める', () => {
    const c = parseConnectionString(
      'Server=tcp:h.database.windows.net,1433;Initial Catalog=kakeibo;User ID=u;Password=p;Encrypt=True;TrustServerCertificate=False;Connection Timeout=45;',
    );
    assert.equal(c.database, 'kakeibo');
    assert.equal(c.user, 'u');
    assert.equal(c.connectionTimeout, 45000);
  });

  it('引用符で囲んだパスワード（; や = を含む）を読める', () => {
    const c = parseConnectionString('Server=h,1433;Database=d;User Id=u;Password="p;ss=w\'rd";Encrypt=true');
    assert.equal(c.password, "p;ss=w'rd");
  });

  it('ポート省略時は 1433、Encrypt 省略時は true、接続タイムアウトの既定は 15 秒', () => {
    const c = parseConnectionString('Server=h.database.windows.net;Database=d;User Id=u;Password=p');
    assert.equal(c.port, 1433);
    assert.equal(c.options.encrypt, true);
    assert.equal(c.connectionTimeout, 15000);
  });

  it('必須項目が足りなければ分かりやすいエラーにする（パスワードは含めない）', () => {
    assert.throws(
      () => parseConnectionString('Server=h;Database=d;Password=secret-pass'),
      (e) => /User Id/.test(e.message) && !/secret-pass/.test(e.message),
    );
  });
});

describe('一時的なエラーの判定', () => {
  it('一時停止からの復帰中（40613 など）は一時的', () => {
    for (const n of [40613, 40197, 40501, 49918, 49919, 49920, 10928, 10929]) {
      assert.equal(isTransient(sqlError(n)), true, `number ${n}`);
    }
  });

  it('元のエラーに入っている番号・接続エラーコード・メッセージも見る', () => {
    assert.equal(isTransient({ originalError: { number: 40613 } }), true);
    assert.equal(isTransient({ originalError: { info: { number: 40613 } } }), true);
    assert.equal(isTransient({ code: 'ESOCKET', message: 'socket hang up' }), true);
    assert.equal(isTransient({ code: 'ELOGIN', message: "Database 'kakeibo' on server 'x' is not currently available." }), true);
  });

  it('入力ミスやログイン失敗、ApiError は一時的ではない', () => {
    assert.equal(isTransient(sqlError(2627)), false);
    assert.equal(isTransient(sqlError(547)), false);
    assert.equal(isTransient({ code: 'ELOGIN', message: "Login failed for user 'x'." }), false);
    assert.equal(isTransient(new ApiError(404, 'NOT_FOUND', 'x')), false);
    assert.equal(isTransient(null), false);
  });
});

describe('指数バックオフのリトライ', () => {
  it('一時的なエラーが続いても、回復すれば成功する', async () => {
    const waits = [];
    let n = 0;
    const result = await withRetry(
      async () => {
        n += 1;
        if (n < 3) throw sqlError(40613);
        return 'ok';
      },
      { sleep: async (ms) => waits.push(ms) },
    );
    assert.equal(result, 'ok');
    assert.equal(n, 3);
    assert.deepEqual(waits, [1000, 2000]);
  });

  it('5 回リトライしてもだめなら 503（DB_UNAVAILABLE）', async () => {
    const waits = [];
    let n = 0;
    await assert.rejects(
      withRetry(
        async () => {
          n += 1;
          throw sqlError(40613);
        },
        { sleep: async (ms) => waits.push(ms) },
      ),
      (e) => e.status === 503 && e.code === 'DB_UNAVAILABLE',
    );
    assert.equal(n, 6); // 最初の 1 回 + リトライ 5 回
    assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000]);
  });

  it('SWA の 45 秒制限に収めるため、経過時間が上限（38 秒）を超えそうなら、回数が残っていても 503 を返す', async () => {
    let t = 0; // 疑似時計（ミリ秒）。接続の試行ごとに 10 秒かかる想定
    const waits = [];
    let n = 0;
    await assert.rejects(
      withRetry(
        async () => {
          n += 1;
          t += 10000;
          throw sqlError(40613);
        },
        { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } },
      ),
      (e) => e.status === 503 && e.code === 'DB_UNAVAILABLE',
    );
    // 試行 1〜3 のあとは待てる（10s+1s, 21s+2s, 33s+4s ≦ 38s）。試行 4 のあと（47s + 8s）は超えるので打ち切り
    assert.equal(n, 4);
    assert.deepEqual(waits, [1000, 2000, 4000]);
    assert.ok(t <= 45000 + 10000);
  });

  it('一時的でないエラーはリトライせず、そのまま投げる', async () => {
    let n = 0;
    const waits = [];
    await assert.rejects(
      withRetry(
        async () => {
          n += 1;
          throw sqlError(2627, 'duplicate');
        },
        { sleep: async (ms) => waits.push(ms) },
      ),
      (e) => e.number === 2627,
    );
    assert.equal(n, 1);
    assert.deepEqual(waits, []);
  });
});

describe('接続プールの共有', () => {
  it('同時に何度 get しても接続処理は 1 回だけ（プールを作り直さない）', async () => {
    let connects = 0;
    const manager = createPoolManager({
      connect: async () => {
        connects += 1;
        return { id: connects };
      },
    });
    const pools = await Promise.all([manager.get(), manager.get(), manager.get()]);
    assert.equal(connects, 1);
    assert.equal(pools[0], pools[2]);
    assert.equal(await manager.get(), pools[0]);
    assert.equal(connects, 1);
  });

  it('接続に失敗したら次の get でやり直せる。reset 後は新しい接続を作る', async () => {
    let connects = 0;
    const manager = createPoolManager({
      connect: async () => {
        connects += 1;
        if (connects === 1) throw sqlError(40613);
        return { id: connects, close: async () => {} };
      },
    });
    await assert.rejects(manager.get(), (e) => e.number === 40613);
    const second = await manager.get();
    assert.equal(second.id, 2);
    await manager.reset();
    const third = await manager.get();
    assert.equal(third.id, 3);
  });
});
