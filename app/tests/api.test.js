import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from '../src/lib/api.js';

const jsonRes = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const errRes = (status, code, message) => jsonRes(status, { error: { code, message } });

/** 呼び出しを記録し、用意した応答を順に返す偽 fetch */
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
}

describe('API クライアント', () => {
  it('GET：クエリを付けて JSON を返す。空の値は付けない', async () => {
    const f = fakeFetch([jsonRes(200, [{ id: 1 }])]);
    const api = createApi({ fetchImpl: f });
    assert.deepEqual(await api.get('/api/transactions', { month: '2026-11', x: '', y: undefined }), [{ id: 1 }]);
    assert.equal(f.calls[0].url, '/api/transactions?month=2026-11');
    assert.equal(f.calls[0].init.method, 'GET');
  });

  it('POST / PUT：JSON ボディと Content-Type を送る。DELETE（204）は null', async () => {
    const f = fakeFetch([jsonRes(201, { id: 5 }), jsonRes(200, { id: 5 }), new Response(null, { status: 204 })]);
    const api = createApi({ fetchImpl: f });
    assert.deepEqual(await api.post('/api/accounts', { name: 'x' }), { id: 5 });
    assert.equal(f.calls[0].init.body, '{"name":"x"}');
    assert.equal(f.calls[0].init.headers['Content-Type'], 'application/json');
    await api.put('/api/accounts/5', { name: 'y' });
    assert.equal(await api.del('/api/accounts/5'), null);
    assert.equal(f.calls[2].init.method, 'DELETE');
  });

  it('エラー応答は { error: { code, message } } を ApiError にする', async () => {
    const api = createApi({ fetchImpl: fakeFetch([errRes(409, 'CONFLICT', '残高が 0 の口座のみアーカイブできます')]) });
    await assert.rejects(api.del('/api/accounts/1'), (e) => e instanceof ApiError && e.status === 409 && e.code === 'CONFLICT' && /残高が 0/.test(e.message));
  });

  it('サーバーが返す診断用のコード（detail）を ApiError に載せる', async () => {
    const api = createApi({ fetchImpl: fakeFetch([jsonRes(503, { error: { code: 'DB_UNAVAILABLE', message: 'x', detail: '40613' } })]), retry: { max: 0, delayMs: 0 } });
    await assert.rejects(api.get('/api/summary'), (e) => e.status === 503 && e.detail === '40613');
  });

  it('JSON でないエラー応答でも、分かるメッセージにする', async () => {
    const api = createApi({ fetchImpl: fakeFetch([new Response('<html>Bad Gateway</html>', { status: 502 })]) });
    await assert.rejects(api.get('/api/summary'), (e) => e.status === 502 && /502/.test(e.message));
  });

  it('通信できないときは NETWORK_ERROR', async () => {
    const api = createApi({ fetchImpl: fakeFetch([new TypeError('Failed to fetch')]) });
    await assert.rejects(api.get('/api/summary'), (e) => e.code === 'NETWORK_ERROR' && e.status === 0);
  });
});

describe('DB 起動中（503）の自動再試行', () => {
  it('GET は 503 の間、待って再試行し、回復したら成功。待機中の表示を切り替える', async () => {
    const f = fakeFetch([errRes(503, 'DB_UNAVAILABLE', 'x'), errRes(503, 'DB_UNAVAILABLE', 'x'), jsonRes(200, { ok: true })]);
    const waits = [];
    const wakingStates = [];
    const api = createApi({ fetchImpl: f, sleep: async (ms) => waits.push(ms), onWaking: (w) => wakingStates.push(w) });
    assert.deepEqual(await api.get('/api/summary'), { ok: true });
    assert.equal(f.calls.length, 3);
    assert.deepEqual(waits, [3000, 3000]);
    assert.deepEqual(wakingStates, [true, false]);
  });

  it('上限まで再試行してもだめなら、503 のエラーを返す（待機中の表示は消す）', async () => {
    const responses = Array.from({ length: 20 }, () => errRes(503, 'DB_UNAVAILABLE', 'DB 起動中'));
    const f = fakeFetch(responses);
    const wakingStates = [];
    const api = createApi({ fetchImpl: f, sleep: async () => {}, retry: { max: 3, delayMs: 10 }, onWaking: (w) => wakingStates.push(w) });
    await assert.rejects(api.get('/api/summary'), (e) => e.status === 503 && e.code === 'DB_UNAVAILABLE');
    assert.equal(f.calls.length, 4); // 最初の 1 回 + 再試行 3 回
    assert.deepEqual(wakingStates, [true, false]);
  });

  it('504（SWA の 45 秒制限に達した）も、GET なら DB 起動待ちとして再試行する。POST は再試行しない', async () => {
    const f = fakeFetch([errRes(504, 'GATEWAY_TIMEOUT', 'x'), jsonRes(200, { ok: true })]);
    const api = createApi({ fetchImpl: f, sleep: async () => {} });
    assert.deepEqual(await api.get('/api/summary'), { ok: true });
    assert.equal(f.calls.length, 2);

    const g = fakeFetch([errRes(504, 'GATEWAY_TIMEOUT', 'x'), jsonRes(201, {})]);
    await assert.rejects(createApi({ fetchImpl: g, sleep: async () => {} }).post('/api/transactions', {}), (e) => e.status === 504);
    assert.equal(g.calls.length, 1);
  });

  it('更新系（POST）は二重登録を避けるため自動再試行しない', async () => {
    const f = fakeFetch([errRes(503, 'DB_UNAVAILABLE', 'x'), jsonRes(201, { id: 1 })]);
    const api = createApi({ fetchImpl: f, sleep: async () => {} });
    await assert.rejects(api.post('/api/transactions', {}), (e) => e.status === 503);
    assert.equal(f.calls.length, 1);
  });

  it('503・504 以外のエラーは再試行しない', async () => {
    const f = fakeFetch([errRes(500, 'INTERNAL_ERROR', 'x'), jsonRes(200, {})]);
    const api = createApi({ fetchImpl: f, sleep: async () => {} });
    await assert.rejects(api.get('/api/summary'), (e) => e.status === 500);
    assert.equal(f.calls.length, 1);
  });
});

describe('ファイルのダウンロード', () => {
  it('Content-Disposition からファイル名を取り出す。無ければ既定名', async () => {
    const withName = new Response('a,b', { status: 200, headers: { 'content-disposition': 'attachment; filename="transactions_20261108.csv"' } });
    const api = createApi({ fetchImpl: fakeFetch([withName, new Response('x', { status: 200 })]) });
    const first = await api.download('/api/export/transactions', { from: '2026-11-01' });
    assert.equal(first.filename, 'transactions_20261108.csv');
    assert.equal(await first.blob.text(), 'a,b');
    assert.equal((await api.download('/api/export/transactions')).filename, 'download.csv');
  });
});
