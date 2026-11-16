'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireOwner } = require('../src/lib/auth');
const { fakeRequest } = require('./helpers/fakeDb');

describe('owner ロールの検証（多層防御）', () => {
  it('owner ロールがあれば通る', () => {
    const principal = requireOwner(fakeRequest({ roles: ['anonymous', 'authenticated', 'owner'] }));
    assert.equal(principal.userDetails, 'me');
  });

  it('ヘッダーがなければ 401', () => {
    assert.throws(() => requireOwner(fakeRequest({ roles: null })), (e) => e.status === 401 && e.code === 'UNAUTHORIZED');
  });

  it('owner ロールがなければ 403', () => {
    assert.throws(
      () => requireOwner(fakeRequest({ roles: ['anonymous', 'authenticated'] })),
      (e) => e.status === 403 && e.code === 'FORBIDDEN',
    );
  });

  it('壊れたヘッダーは 401', () => {
    const req = fakeRequest();
    req.headers.set('x-ms-client-principal', '!!!not-a-valid-principal!!!');
    assert.throws(() => requireOwner(req), (e) => e.status === 401);
  });

  it('userRoles が無いヘッダーは 403', () => {
    const req = fakeRequest();
    req.headers.set('x-ms-client-principal', Buffer.from(JSON.stringify({ userId: 'x' })).toString('base64'));
    assert.throws(() => requireOwner(req), (e) => e.status === 403);
  });
});
