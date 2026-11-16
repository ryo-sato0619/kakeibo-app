'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { route, ok, created, noContent, csvResponse } = require('../src/lib/http');
const { notFound } = require('../src/lib/errors');
const { fakeRequest } = require('./helpers/fakeDb');

const fakeDb = { marker: 'db' };
const wrap = (handlers) => route(handlers, { getDb: () => fakeDb });
const body = (res) => res.jsonBody;

describe('HTTP ラッパー（認証・エラー変換）', () => {
  it('未認証は 401、owner なしは 403（ハンドラーは呼ばれない）', async () => {
    let called = 0;
    const handler = wrap({ GET: async () => { called += 1; return ok({}); } });
    const r401 = await handler(fakeRequest({ roles: null }));
    const r403 = await handler(fakeRequest({ roles: ['authenticated'] }));
    assert.equal(r401.status, 401);
    assert.equal(body(r401).error.code, 'UNAUTHORIZED');
    assert.equal(r403.status, 403);
    assert.equal(body(r403).error.code, 'FORBIDDEN');
    assert.equal(called, 0);
  });

  it('owner なら DB・パラメータ・クエリがハンドラーに渡る。キャッシュは禁止', async () => {
    const handler = wrap({
      GET: async ({ db, params, query }) => ok({ db: db.marker, id: params.id, month: query.get('month') }),
    });
    const res = await handler(fakeRequest({ params: { id: '5' }, query: 'month=2026-11' }));
    assert.equal(res.status, 200);
    assert.deepEqual(body(res), { db: 'db', id: '5', month: '2026-11' });
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  it('メソッドで処理を振り分け、未対応のメソッドは 405', async () => {
    const handler = wrap({ GET: async () => ok({ m: 'get' }), POST: async () => created({ m: 'post' }) });
    assert.equal((await handler(fakeRequest({ method: 'POST' }))).status, 201);
    assert.equal((await handler(fakeRequest({ method: 'GET' }))).status, 200);
    const res = await handler(fakeRequest({ method: 'DELETE' }));
    assert.equal(res.status, 405);
    assert.equal(body(res).error.code, 'METHOD_NOT_ALLOWED');
  });

  it('ApiError はそのままのステータスと { error: { code, message } } で返す', async () => {
    const handler = wrap({ GET: async () => { throw notFound('口座が見つかりません'); } });
    const res = await handler(fakeRequest());
    assert.equal(res.status, 404);
    assert.deepEqual(body(res), { error: { code: 'NOT_FOUND', message: '口座が見つかりません' } });
  });

  it('DB が起動中（40613）なら 503', async () => {
    const handler = wrap({ GET: async () => { throw Object.assign(new Error('x'), { number: 40613 }); } });
    const res = await handler(fakeRequest());
    assert.equal(res.status, 503);
    assert.equal(body(res).error.code, 'DB_UNAVAILABLE');
  });

  it('一意制約違反（2627）・外部キー違反（547）は 409', async () => {
    const dup = wrap({ GET: async () => { throw Object.assign(new Error('dup'), { number: 2627 }); } });
    const fk = wrap({ GET: async () => { throw Object.assign(new Error('fk'), { number: 547 }); } });
    assert.equal((await dup(fakeRequest())).status, 409);
    assert.equal((await fk(fakeRequest())).status, 409);
  });

  it('想定外のエラーは 500。内部の詳細は返さず、ログにだけ残す', async () => {
    const logged = [];
    const handler = wrap({ GET: async () => { throw new Error("Invalid object name 'secret_table'"); } });
    const res = await handler(fakeRequest(), { error: (e) => logged.push(e) });
    assert.equal(res.status, 500);
    assert.equal(body(res).error.code, 'INTERNAL_ERROR');
    assert.ok(!JSON.stringify(body(res)).includes('secret_table'));
    assert.equal(logged.length, 1);
  });

  it('JSON として読めないボディは 400', async () => {
    const handler = wrap({ POST: async ({ readJson }) => ok(await readJson()) });
    const res = await handler(fakeRequest({ method: 'POST' })); // body 未指定 → json() が失敗
    assert.equal(res.status, 400);
    assert.equal(body(res).error.code, 'VALIDATION_ERROR');
  });

  it('204 と CSV（UTF-8 BOM 付き）のレスポンス', () => {
    assert.equal(noContent().status, 204);
    const csv = csvResponse('a,b\r\n', 'x.csv');
    assert.ok(csv.body.startsWith('\uFEFF'));
    assert.match(csv.headers['content-type'], /text\/csv; charset=utf-8/);
    assert.match(csv.headers['content-disposition'], /attachment; filename="x\.csv"/);
  });
});
