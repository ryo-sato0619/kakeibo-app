'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const accounts = require('../src/services/accounts');
const { getSummary } = require('../src/services/summary');
const { createFakeDb, scripted } = require('./helpers/fakeDb');

const acct = (over = {}) => ({
  id: 1, name: '三菱UFJ', kind: 'bank', openingBalance: 0, sortOrder: 10, isArchived: false, balance: 0, ...over,
});

describe('口座', () => {
  it('登録：名称・種別を検証し、表示順は最大値 + 10 を既定にする', async () => {
    const db = createFakeDb(
      scripted([
        ['MAX(sort_order)', [{ n: 30 }]],
        ['INSERT INTO accounts', [{ id: 4 }]],
        ['FROM v_account_balances', [acct({ id: 4, name: '現金', kind: 'cash', sortOrder: 30 })]],
      ]),
    );
    const created = await accounts.createAccount(db, { name: ' 現金 ', kind: 'cash' });
    assert.equal(created.id, 4);
    const insert = db.calls.find((c) => c.sql.startsWith('INSERT INTO accounts'));
    assert.deepEqual(insert.params, { name: '現金', kind: 'cash', openingBalance: 0, sortOrder: 30 });
  });

  it('登録：種別や初期残高が不正なら 400 で、DB には何も書かない', async () => {
    const db = createFakeDb();
    await assert.rejects(accounts.createAccount(db, { name: 'x', kind: 'wallet' }), (e) => e.status === 400);
    await assert.rejects(accounts.createAccount(db, { name: '', kind: 'bank' }), (e) => e.status === 400);
    await assert.rejects(accounts.createAccount(db, { name: 'x', kind: 'bank', openingBalance: 1.5 }), (e) => e.status === 400);
    assert.equal(db.writes().length, 0);
  });

  it('アーカイブ：残高が 0 でなければ 409（更新しない）', async () => {
    const db = createFakeDb(scripted([['FROM v_account_balances', [acct({ balance: 1200 })]]]));
    await assert.rejects(accounts.archiveAccount(db, 1), (e) => e.status === 409 && /残高が 0/.test(e.message));
    assert.equal(db.writes().length, 0);
  });

  it('アーカイブ：マイナス残高（クレジットカードの未払い）も 0 ではないので 409', async () => {
    const db = createFakeDb(scripted([['FROM v_account_balances', [acct({ kind: 'credit', balance: -800 })]]]));
    await assert.rejects(accounts.archiveAccount(db, 1), (e) => e.status === 409);
  });

  it('アーカイブ：残高 0 なら論理削除する（DELETE ではなく is_archived = 1）', async () => {
    const db = createFakeDb(scripted([['FROM v_account_balances', [acct({ balance: 0 })]]]));
    await accounts.archiveAccount(db, 1);
    const w = db.writes();
    assert.equal(w.length, 1);
    assert.match(w[0].sql, /^UPDATE accounts SET is_archived = 1 WHERE id = @id$/);
  });

  it('アーカイブ：存在しない・アーカイブ済みは 404', async () => {
    await assert.rejects(accounts.archiveAccount(createFakeDb(), 9), (e) => e.status === 404);
    const archived = createFakeDb(scripted([['FROM v_account_balances', [acct({ isArchived: true })]]]));
    await assert.rejects(accounts.archiveAccount(archived, 1), (e) => e.status === 404);
  });

  it('編集：指定した項目だけ更新し、空の更新は 400、アーカイブ済みは 409', async () => {
    const db = createFakeDb(scripted([['FROM v_account_balances', [acct()]]]));
    await accounts.updateAccount(db, 1, { name: '新しい名前', openingBalance: -5000 });
    const update = db.writes()[0];
    assert.match(update.sql, /SET name = @p0, opening_balance = @p1 WHERE id = @id/);
    assert.deepEqual(update.params, { id: 1, p0: '新しい名前', p1: -5000 });

    await assert.rejects(accounts.updateAccount(db, 1, {}), (e) => e.status === 400);
    const archived = createFakeDb(scripted([['FROM v_account_balances', [acct({ isArchived: true })]]]));
    await assert.rejects(accounts.updateAccount(archived, 1, { name: 'x' }), (e) => e.status === 409);
  });
});

describe('サマリー（総資産・使えるお金）', () => {
  const summaryDb = (totalAssets, savingsAllocated) =>
    createFakeDb(
      scripted([
        ['AS totalAssets', [{ totalAssets, savingsAllocated }]],
        ['FROM v_account_balances b', [acct({ balance: totalAssets })]],
      ]),
    );

  it('使えるお金 = 総資産 − 貯金割当合計', async () => {
    const s = await getSummary(summaryDb(300000, 120000));
    assert.equal(s.totalAssets, 300000);
    assert.equal(s.savingsAllocated, 120000);
    assert.equal(s.available, 180000);
    assert.equal(s.isOverAllocated, false);
    assert.equal(s.accounts.length, 1);
  });

  it('割当が総資産を超えたらマイナスになり、isOverAllocated で警告できる', async () => {
    const s = await getSummary(summaryDb(50000, 80000));
    assert.equal(s.available, -30000);
    assert.equal(s.isOverAllocated, true);
  });
});
