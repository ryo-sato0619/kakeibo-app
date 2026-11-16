'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const savings = require('../src/services/savings');
const { createFakeDb, scripted } = require('./helpers/fakeDb');

const goal = (over = {}) => ({
  id: 1, name: '旅行', targetAmount: 100000, sortOrder: 10, isArchived: false, allocatedAmount: 30000, ...over,
});
const NOW = () => Date.UTC(2026, 10, 8, 3, 0, 0); // 2026-11-08 12:00 JST

const goalRule = (g) => ['FROM savings_goals g', [g]];
const masters = [
  [/FROM accounts WHERE id = @id/, ({ params }) => ({ 1: [{ isArchived: false }], 3: [{ isArchived: true }] }[params.id] || [])],
  [/FROM categories WHERE id = @id/, ({ params }) => ({ 3: [{ type: 'expense', isArchived: false }], 4: [{ type: 'income', isArchived: false }] }[params.id] || [])],
];

describe('貯金目的', () => {
  it('一覧：進捗率 = 割当額 ÷ 目標金額（目標 0 は null）', async () => {
    const db = createFakeDb(scripted([['FROM savings_goals g', [goal({ allocatedAmount: 25000 }), goal({ id: 2, targetAmount: 0, allocatedAmount: 500 })]]]));
    const list = await savings.listGoals(db);
    assert.equal(list[0].progressRate, 0.25);
    assert.equal(list[1].progressRate, null);
  });

  it('登録：目標金額は省略可（0）、不正な値は 400', async () => {
    const db = createFakeDb(scripted([['MAX(sort_order)', [{ n: 20 }]], ['INSERT INTO savings_goals', [{ id: 5 }]], goalRule(goal({ id: 5 }))]));
    await savings.createGoal(db, { name: '緊急資金' });
    assert.deepEqual(db.calls.find((c) => c.sql.startsWith('INSERT')).params, { name: '緊急資金', targetAmount: 0, sortOrder: 20 });
    await assert.rejects(savings.createGoal(db, { name: 'x', targetAmount: -1 }), (e) => e.status === 400);
  });
});

describe('割当・解除', () => {
  it('割当：正の金額を履歴に追加する（日付省略時は今日の JST）', async () => {
    const db = createFakeDb(
      scripted([goalRule(goal()), ['INSERT INTO savings_allocations', [{ id: 9 }]], ['FROM savings_allocations WHERE id = @id', [{ id: 9, amount: 5000 }]]]),
    );
    const result = await savings.createAllocation(db, 1, { amount: 5000, memo: '給料日' }, { now: NOW });
    assert.equal(result.id, 9);
    const insert = db.calls.find((c) => c.sql.startsWith('INSERT INTO savings_allocations'));
    assert.deepEqual(insert.params, { goalId: 1, date: '2026-11-08', amount: 5000, memo: '給料日' });
  });

  it('使えるお金を超える割当でも拒否しない（マイナス表示で警告する設計）', async () => {
    const db = createFakeDb(scripted([goalRule(goal()), ['INSERT INTO savings_allocations', [{ id: 9 }]], ['FROM savings_allocations WHERE id = @id', [{ id: 9 }]]]));
    await savings.createAllocation(db, 1, { amount: 99999999 }, { now: NOW });
    assert.equal(db.calls.filter((c) => c.sql.startsWith('INSERT')).length, 1);
  });

  it('解除：割当額の範囲内ならマイナスで記録、超える解除は 409', async () => {
    const ok = createFakeDb(scripted([goalRule(goal({ allocatedAmount: 30000 })), ['INSERT INTO savings_allocations', [{ id: 9 }]], ['FROM savings_allocations WHERE id = @id', [{ id: 9 }]]]));
    await savings.createAllocation(ok, 1, { amount: -30000 }, { now: NOW });
    assert.equal(ok.calls.find((c) => c.sql.startsWith('INSERT')).params.amount, -30000);

    const over = createFakeDb(scripted([goalRule(goal({ allocatedAmount: 30000 }))]));
    await assert.rejects(savings.createAllocation(over, 1, { amount: -30001 }, { now: NOW }), (e) => e.status === 409);
    assert.equal(over.writes().length, 0);
  });

  it('金額 0・存在しない目的・アーカイブ済みは拒否', async () => {
    await assert.rejects(savings.createAllocation(createFakeDb(), 1, { amount: 0 }), (e) => e.status === 400);
    await assert.rejects(savings.createAllocation(createFakeDb(), 1, { amount: 100 }), (e) => e.status === 404);
    const archived = createFakeDb(scripted([goalRule(goal({ isArchived: true }))]));
    await assert.rejects(savings.createAllocation(archived, 1, { amount: 100 }), (e) => e.status === 409);
  });
});

describe('この貯金で支払う（出金登録 + 割当解除を 1 トランザクション）', () => {
  const body = { date: '2026-11-08', accountId: 1, categoryId: 3, amount: 8000, memo: '新幹線' };
  const happy = () =>
    scripted([
      goalRule(goal({ allocatedAmount: 30000 })),
      ...masters,
      ['INSERT INTO transactions', [{ id: 50 }]],
      ['INSERT INTO savings_allocations', [{ id: 60 }]],
      ['FROM savings_allocations WHERE id = @id', [{ id: 60, amount: -8000, transactionId: 50 }]],
      ['WHERE t.id = @id', [{ id: 50, type: 'expense', amount: 8000 }]],
    ]);

  it('出金（expense）と、同額のマイナス割当（取引に紐付け）を 1 つのトランザクションで登録する', async () => {
    const db = createFakeDb(happy());
    const result = await savings.spendFromGoal(db, 1, body);

    const kinds = db.calls.map((c) => c.kind);
    assert.equal(kinds[0], 'begin');
    assert.equal(kinds[kinds.length - 1], 'commit');
    assert.equal(kinds.filter((k) => k === 'begin').length, 1);

    const insertTx = db.calls.find((c) => c.sql.startsWith('INSERT INTO transactions'));
    assert.equal(insertTx.params.type, 'expense');
    assert.equal(insertTx.params.amount, 8000);
    assert.equal(insertTx.params.accountId, 1);

    const insertAlloc = db.calls.find((c) => c.sql.startsWith('INSERT INTO savings_allocations'));
    assert.deepEqual(insertAlloc.params, { goalId: 1, date: '2026-11-08', amount: -8000, transactionId: 50, memo: '新幹線' });

    // 出金の登録が先、割当解除が後（取引 ID を紐付けるため）
    assert.ok(db.calls.indexOf(insertTx) < db.calls.indexOf(insertAlloc));
    assert.equal(result.transaction.id, 50);
    assert.equal(result.allocation.transactionId, 50);
  });

  it('割当額が足りなければ 409。何も登録せず、コミットもしない', async () => {
    const db = createFakeDb(scripted([goalRule(goal({ allocatedAmount: 7999 })), ...masters]));
    await assert.rejects(savings.spendFromGoal(db, 1, body), (e) => e.status === 409 && /割当額/.test(e.message));
    assert.equal(db.writes().length, 0);
    assert.ok(db.calls.some((c) => c.kind === 'rollback'));
    assert.ok(!db.calls.some((c) => c.kind === 'commit'));
  });

  it('割当額ちょうどの支払いはできる（境界値）', async () => {
    const db = createFakeDb(scripted([goalRule(goal({ allocatedAmount: 8000 })), ...masters, ['INSERT INTO transactions', [{ id: 50 }]], ['INSERT INTO savings_allocations', [{ id: 60 }]], ['FROM savings_allocations WHERE id = @id', [{ id: 60 }]], ['WHERE t.id = @id', [{ id: 50 }]]]));
    await savings.spendFromGoal(db, 1, body);
    assert.ok(db.calls.some((c) => c.kind === 'commit'));
  });

  it('割当解除の登録に失敗したら ROLLBACK（出金だけが残らない）', async () => {
    const responder = scripted([
      goalRule(goal()),
      ...masters,
      ['INSERT INTO transactions', [{ id: 50 }]],
      ['INSERT INTO savings_allocations', () => { throw new Error('割当の登録に失敗'); }],
    ]);
    const db = createFakeDb(responder);
    await assert.rejects(savings.spendFromGoal(db, 1, body), /割当の登録に失敗/);
    assert.ok(db.calls.some((c) => c.kind === 'rollback'));
    assert.ok(!db.calls.some((c) => c.kind === 'commit'));
  });

  it('入力の不備は DB を開く前に 400（アーカイブ済みの口座、振替先の指定、種別は常に出金）', async () => {
    const archivedAcct = createFakeDb(happy());
    await assert.rejects(savings.spendFromGoal(archivedAcct, 1, { ...body, accountId: 3 }), (e) => e.status === 400);
    assert.ok(!archivedAcct.calls.some((c) => c.kind === 'commit'));

    const withTransferTarget = createFakeDb(happy());
    await assert.rejects(savings.spendFromGoal(withTransferTarget, 1, { ...body, toAccountId: 2 }), (e) => e.status === 400);
    assert.equal(withTransferTarget.calls.length, 0);

    // type に income を指定されても、出金として扱う（カテゴリが入金用なら 400）
    const db = createFakeDb(happy());
    await assert.rejects(savings.spendFromGoal(db, 1, { ...body, type: 'income', categoryId: 4 }), (e) => e.status === 400);
  });

  it('アーカイブ済み・存在しない貯金目的では支払えない', async () => {
    const archived = createFakeDb(scripted([goalRule(goal({ isArchived: true })), ...masters]));
    await assert.rejects(savings.spendFromGoal(archived, 1, body), (e) => e.status === 409);
    await assert.rejects(savings.spendFromGoal(createFakeDb(scripted(masters)), 1, body), (e) => e.status === 404);
  });
});

describe('貯金目的のアーカイブ', () => {
  it('残っている割当額を、マイナスの割当で自動解除してからアーカイブする', async () => {
    const db = createFakeDb(scripted([goalRule(goal({ allocatedAmount: 12000 }))]));
    await savings.archiveGoal(db, 1, { now: NOW });
    const writes = db.writes();
    assert.equal(writes.length, 2);
    assert.match(writes[0].sql, /^INSERT INTO savings_allocations/);
    assert.deepEqual(writes[0].params, { goalId: 1, date: '2026-11-08', amount: -12000, memo: 'アーカイブに伴う自動解除' });
    assert.match(writes[1].sql, /^UPDATE savings_goals SET is_archived = 1/);
    assert.equal(db.calls[db.calls.length - 1].kind, 'commit');
  });

  it('割当額が 0 なら解除の記録は作らず、アーカイブだけ行う', async () => {
    const db = createFakeDb(scripted([goalRule(goal({ allocatedAmount: 0 }))]));
    await savings.archiveGoal(db, 1, { now: NOW });
    assert.equal(db.writes().length, 1);
    assert.match(db.writes()[0].sql, /^UPDATE savings_goals SET is_archived = 1/);
  });

  it('存在しない・アーカイブ済みは 404（ロールバック）', async () => {
    const db = createFakeDb();
    await assert.rejects(savings.archiveGoal(db, 1), (e) => e.status === 404);
    assert.ok(db.calls.some((c) => c.kind === 'rollback'));
    const archived = createFakeDb(scripted([goalRule(goal({ isArchived: true }))]));
    await assert.rejects(savings.archiveGoal(archived, 1), (e) => e.status === 404);
  });
});
