'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const tx = require('../src/services/transactions');
const { createFakeDb, scripted } = require('./helpers/fakeDb');

const bad = (e) => e.status === 400 && e.code === 'VALIDATION_ERROR';

const row = (over = {}) => ({
  id: 1, date: '2026-11-08', type: 'expense', accountId: 1, accountName: '現金', toAccountId: null, toAccountName: null,
  categoryId: 3, categoryName: '食費', amount: 1200, memo: null, createdAt: new Date(), updatedAt: null, savingsGoalId: null, ...over,
});

// 口座 1・2 は有効、3 はアーカイブ済み。カテゴリ 3 は出金、4 は入金、5 は削除済みの出金。
const masters = [
  [/FROM accounts WHERE id = @id/, ({ params }) => ({ 1: [{ isArchived: false }], 2: [{ isArchived: false }], 3: [{ isArchived: true }] }[params.id] || [])],
  [/FROM categories WHERE id = @id/, ({ params }) => ({
    3: [{ type: 'expense', isArchived: false }],
    4: [{ type: 'income', isArchived: false }],
    5: [{ type: 'expense', isArchived: true }],
  }[params.id] || [])],
];

describe('取引の入力検証', () => {
  const base = { date: '2026-11-08', amount: 1200, accountId: 1 };

  it('出金・入金：カテゴリが必須で、振替先は指定できない', () => {
    assert.deepEqual(tx.parseTransactionBody({ ...base, type: 'expense', categoryId: 3, memo: ' ランチ ' }), {
      type: 'expense', date: '2026-11-08', amount: 1200, memo: 'ランチ', accountId: 1, toAccountId: null, categoryId: 3,
    });
    assert.throws(() => tx.parseTransactionBody({ ...base, type: 'expense' }), bad);
    assert.throws(() => tx.parseTransactionBody({ ...base, type: 'income', categoryId: 4, toAccountId: 2 }), bad);
  });

  it('振替：振替先が必須、カテゴリは指定できず、同じ口座間は不可', () => {
    const ok = tx.parseTransactionBody({ ...base, type: 'transfer', toAccountId: 2 });
    assert.equal(ok.categoryId, null);
    assert.equal(ok.toAccountId, 2);
    assert.throws(() => tx.parseTransactionBody({ ...base, type: 'transfer' }), bad);
    assert.throws(() => tx.parseTransactionBody({ ...base, type: 'transfer', toAccountId: 2, categoryId: 3 }), bad);
    assert.throws(() => tx.parseTransactionBody({ ...base, type: 'transfer', toAccountId: 1 }), bad);
  });

  it('金額・日付・種別が不正なら 400', () => {
    assert.throws(() => tx.parseTransactionBody({ ...base, type: 'expense', categoryId: 3, amount: 0 }), bad);
    assert.throws(() => tx.parseTransactionBody({ ...base, type: 'expense', categoryId: 3, amount: 12.5 }), bad);
    assert.throws(() => tx.parseTransactionBody({ ...base, type: 'expense', categoryId: 3, date: '2026-02-30' }), bad);
    assert.throws(() => tx.parseTransactionBody({ ...base, type: 'refund', categoryId: 3 }), bad);
    assert.throws(() => tx.parseTransactionBody(null), bad);
  });
});

describe('取引の参照チェック（口座・カテゴリ）', () => {
  const run = (input, existing = null) => tx.assertReferences(createFakeDb(scripted(masters)), input, existing);
  const expense = { type: 'expense', accountId: 1, toAccountId: null, categoryId: 3 };

  it('有効な口座・カテゴリなら通る', async () => {
    await run(expense);
    await run({ type: 'transfer', accountId: 1, toAccountId: 2, categoryId: null });
  });

  it('存在しない口座・カテゴリは 400', async () => {
    await assert.rejects(run({ ...expense, accountId: 99 }), bad);
    await assert.rejects(run({ ...expense, categoryId: 99 }), bad);
  });

  it('アーカイブ済みの口座・カテゴリは新規の取引に指定できない', async () => {
    await assert.rejects(run({ ...expense, accountId: 3 }), bad);
    await assert.rejects(run({ type: 'transfer', accountId: 1, toAccountId: 3, categoryId: null }), bad);
    await assert.rejects(run({ ...expense, categoryId: 5 }), bad);
  });

  it('カテゴリの種別と取引の種別が違えば 400（出金に入金カテゴリ）', async () => {
    await assert.rejects(run({ ...expense, categoryId: 4 }), (e) => bad(e) && /種別/.test(e.message));
  });

  it('編集時は、元の取引が使っているアーカイブ済みの口座・カテゴリをそのまま残せる', async () => {
    await run({ ...expense, accountId: 3, categoryId: 5 }, { accountId: 3, toAccountId: null, categoryId: 5 });
    // 別のアーカイブ済みへ変更するのは不可
    await assert.rejects(run({ ...expense, accountId: 3 }, { accountId: 1, toAccountId: null, categoryId: 3 }), bad);
  });
});

describe('取引の登録・編集・削除', () => {
  it('登録：検証 → 参照チェック → INSERT。不正なら何も書かない', async () => {
    const db = createFakeDb(scripted([...masters, ['INSERT INTO transactions', [{ id: 10 }]], ['WHERE t.id = @id', [row({ id: 10 })]]]));
    const created = await tx.createTransaction(db, { type: 'expense', date: '2026-11-08', amount: 1200, accountId: 1, categoryId: 3 });
    assert.equal(created.id, 10);
    assert.equal(db.writes().length, 1);

    const db2 = createFakeDb(scripted(masters));
    await assert.rejects(tx.createTransaction(db2, { type: 'expense', date: '2026-11-08', amount: 1200, accountId: 3, categoryId: 3 }), bad);
    assert.equal(db2.writes().length, 0);
  });

  it('編集：更新日時を更新し、存在しなければ 404', async () => {
    const db = createFakeDb(scripted([...masters, ['WHERE t.id = @id', [row()]]]));
    await tx.updateTransaction(db, 1, { type: 'expense', date: '2026-11-09', amount: 1500, accountId: 1, categoryId: 3 });
    const update = db.writes()[0];
    assert.match(update.sql, /updated_at = SYSUTCDATETIME\(\)/);
    assert.equal(update.params.id, 1);
    assert.equal(update.params.amount, 1500);

    await assert.rejects(
      tx.updateTransaction(createFakeDb(), 99, { type: 'expense', date: '2026-11-09', amount: 1, accountId: 1, categoryId: 3 }),
      (e) => e.status === 404,
    );
  });

  it('編集：貯金で支払った取引は、金額・種別を変えると 409。日付やメモは変えられる', async () => {
    const linked = row({ savingsGoalId: 2, amount: 5000 });
    const responder = scripted([...masters, ['WHERE t.id = @id', [linked]]]);
    await assert.rejects(
      tx.updateTransaction(createFakeDb(responder), 1, { type: 'expense', date: '2026-11-08', amount: 6000, accountId: 1, categoryId: 3 }),
      (e) => e.status === 409,
    );
    const db = createFakeDb(responder);
    await tx.updateTransaction(db, 1, { type: 'expense', date: '2026-11-10', amount: 5000, accountId: 1, categoryId: 3, memo: '日付修正' });
    assert.equal(db.writes().length, 1);
  });

  it('削除：存在しなければ 404、あれば DELETE（割当解除は ON DELETE CASCADE で連動）', async () => {
    await assert.rejects(tx.deleteTransaction(createFakeDb(), 1), (e) => e.status === 404);
    const db = createFakeDb(scripted([['WHERE t.id = @id', [row()]]]));
    await tx.deleteTransaction(db, 1);
    assert.match(db.writes()[0].sql, /^DELETE FROM transactions WHERE id = @id$/);
  });

  it('一覧：月は必須で、月初〜翌月初（含まない）で検索する', async () => {
    const db = createFakeDb();
    await tx.listTransactions(db, '2026-12');
    assert.deepEqual(db.calls[0].params, { start: '2026-12-01', end: '2027-01-01' });
    await assert.rejects(tx.listTransactions(db, '2026-13'), bad);
  });
});
