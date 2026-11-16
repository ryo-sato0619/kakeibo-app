'use strict';

const {
  requireObject,
  parseName,
  parseTargetAmount,
  parseSortOrder,
  parseSignedAmount,
  parseDate,
  parseMemo,
  isPresent,
} = require('../lib/validate');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { todayJst } = require('../lib/dates');
const { nextSortOrder, updateRow } = require('./common');
const { parseTransactionBody, assertReferences, insertTransaction, getTransaction } = require('./transactions');

// 貯金の現在額は保存せず、savings_allocations（割当・解除の履歴）の合計で求める。
const GOAL_SELECT = `
  SELECT g.id, g.name, g.target_amount AS targetAmount, g.sort_order AS sortOrder,
         g.is_archived AS isArchived, COALESCE(SUM(s.amount), 0) AS allocatedAmount
  FROM savings_goals g
  LEFT JOIN savings_allocations s ON s.goal_id = g.id`;
const GOAL_GROUP = 'GROUP BY g.id, g.name, g.target_amount, g.sort_order, g.is_archived';

const ALLOCATION_SELECT = `
  SELECT id, goal_id AS goalId, CONVERT(char(10), date, 23) AS date, amount,
         transaction_id AS transactionId, memo, created_at AS createdAt
  FROM savings_allocations`;

/** 進捗率 = 割当額 ÷ 目標金額（目標が 0 のときは null）。例：0.5 は 50% */
function withProgress(row) {
  const progressRate =
    row.targetAmount > 0 ? Math.round((row.allocatedAmount / row.targetAmount) * 10000) / 10000 : null;
  return { ...row, progressRate };
}

const today = (opts) => todayJst(opts && opts.now ? opts.now() : Date.now());

async function listGoals(db, { includeArchived = false } = {}) {
  const where = includeArchived ? '' : 'WHERE g.is_archived = 0';
  const rows = await db.query(`${GOAL_SELECT} ${where} ${GOAL_GROUP} ORDER BY g.sort_order, g.id`);
  return rows.map(withProgress);
}

async function getGoal(db, id) {
  const rows = await db.query(`${GOAL_SELECT} WHERE g.id = @id ${GOAL_GROUP}`, { id });
  return rows[0] ? withProgress(rows[0]) : null;
}

async function createGoal(db, body) {
  const obj = requireObject(body);
  const name = parseName(obj.name);
  const targetAmount = isPresent(obj.targetAmount) ? parseTargetAmount(obj.targetAmount) : 0;
  const sortOrder = isPresent(obj.sortOrder)
    ? parseSortOrder(obj.sortOrder)
    : await nextSortOrder(db, 'savings_goals');
  const rows = await db.query(
    `INSERT INTO savings_goals (name, target_amount, sort_order)
     OUTPUT INSERTED.id AS id
     VALUES (@name, @targetAmount, @sortOrder)`,
    { name, targetAmount, sortOrder },
  );
  return getGoal(db, rows[0].id);
}

async function updateGoal(db, id, body) {
  const obj = requireObject(body);
  const existing = await getGoal(db, id);
  if (!existing) throw notFound('貯金目的が見つかりません');
  if (existing.isArchived) throw conflict('アーカイブ済みの貯金目的は編集できません');

  const sets = {};
  if (obj.name !== undefined) sets.name = parseName(obj.name);
  if (obj.targetAmount !== undefined) sets.target_amount = parseTargetAmount(obj.targetAmount);
  if (obj.sortOrder !== undefined) sets.sort_order = parseSortOrder(obj.sortOrder);
  if (Object.keys(sets).length === 0) throw badRequest('更新する項目がありません');

  await updateRow(db, 'savings_goals', id, sets);
  return getGoal(db, id);
}

/** アーカイブ。残っている割当額は、マイナスの割当を登録して自動で解除し、使えるお金に戻す。 */
async function archiveGoal(db, id, opts) {
  await db.transaction(async (tx) => {
    const goal = await getGoal(tx, id);
    if (!goal || goal.isArchived) throw notFound('貯金目的が見つかりません');
    if (goal.allocatedAmount !== 0) {
      await tx.execute(
        `INSERT INTO savings_allocations (goal_id, date, amount, memo)
         VALUES (@goalId, @date, @amount, @memo)`,
        {
          goalId: id,
          date: today(opts),
          amount: -goal.allocatedAmount,
          memo: 'アーカイブに伴う自動解除',
        },
      );
    }
    await tx.execute('UPDATE savings_goals SET is_archived = 1 WHERE id = @id', { id });
  });
}

async function listAllocations(db, goalId) {
  const goal = await getGoal(db, goalId);
  if (!goal) throw notFound('貯金目的が見つかりません');
  return db.query(`${ALLOCATION_SELECT} WHERE goal_id = @goalId ORDER BY date DESC, id DESC`, { goalId });
}

/** 割当・解除の登録（amount の正負）。解除は現在の割当額を超えられない。 */
async function createAllocation(db, goalId, body, opts) {
  const obj = requireObject(body);
  const amount = parseSignedAmount(obj.amount);
  const date = isPresent(obj.date) ? parseDate(obj.date) : today(opts);
  const memo = parseMemo(obj.memo);

  return db.transaction(async (tx) => {
    const goal = await getGoal(tx, goalId);
    if (!goal) throw notFound('貯金目的が見つかりません');
    if (goal.isArchived) throw conflict('アーカイブ済みの貯金目的には割当・解除できません');
    if (amount < 0 && goal.allocatedAmount + amount < 0) {
      throw conflict(`解除額が現在の割当額（${goal.allocatedAmount}円）を超えています`);
    }
    const rows = await tx.query(
      `INSERT INTO savings_allocations (goal_id, date, amount, memo)
       OUTPUT INSERTED.id AS id
       VALUES (@goalId, @date, @amount, @memo)`,
      { goalId, date, amount, memo },
    );
    const created = await tx.query(`${ALLOCATION_SELECT} WHERE id = @id`, { id: rows[0].id });
    return created[0];
  });
}

/**
 * 「この貯金で支払う」：出金の登録と、同額の割当解除を 1 つの DB トランザクションで行う。
 * 割当額が支払額に足りないときは 409。
 */
async function spendFromGoal(db, goalId, body) {
  const obj = requireObject(body);
  const input = parseTransactionBody({ ...obj, type: 'expense' });

  return db.transaction(async (tx) => {
    const goal = await getGoal(tx, goalId);
    if (!goal) throw notFound('貯金目的が見つかりません');
    if (goal.isArchived) throw conflict('アーカイブ済みの貯金目的では支払えません');
    if (goal.allocatedAmount < input.amount) {
      throw conflict(`割当額（${goal.allocatedAmount}円）が支払額より少ないため、この貯金では支払えません`);
    }
    await assertReferences(tx, input, null);

    const transactionId = await insertTransaction(tx, input);
    const rows = await tx.query(
      `INSERT INTO savings_allocations (goal_id, date, amount, transaction_id, memo)
       OUTPUT INSERTED.id AS id
       VALUES (@goalId, @date, @amount, @transactionId, @memo)`,
      { goalId, date: input.date, amount: -input.amount, transactionId, memo: input.memo },
    );
    const allocation = await tx.query(`${ALLOCATION_SELECT} WHERE id = @id`, { id: rows[0].id });
    return {
      transaction: await getTransaction(tx, transactionId),
      allocation: allocation[0],
      goal: await getGoal(tx, goalId),
    };
  });
}

module.exports = {
  listGoals,
  getGoal,
  createGoal,
  updateGoal,
  archiveGoal,
  listAllocations,
  createAllocation,
  spendFromGoal,
};
