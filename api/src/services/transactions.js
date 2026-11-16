'use strict';

const {
  requireObject,
  parseId,
  parseAmount,
  parseDate,
  parseMemo,
  parseEnum,
  parseMonth,
  isPresent,
} = require('../lib/validate');
const { badRequest, notFound, conflict } = require('../lib/errors');

const TX_TYPES = ['income', 'expense', 'transfer'];

// date は 'YYYY-MM-DD' の文字列で返す（タイムゾーンのずれを避ける）。
// savingsGoalId は「この貯金で支払う」で登録された取引のときだけ値が入る。
const TX_SELECT = `
  SELECT t.id, CONVERT(char(10), t.date, 23) AS date, t.type,
         t.account_id AS accountId, a.name AS accountName,
         t.to_account_id AS toAccountId, ta.name AS toAccountName,
         t.category_id AS categoryId, c.name AS categoryName,
         t.amount, t.memo, t.created_at AS createdAt, t.updated_at AS updatedAt,
         (SELECT TOP 1 s.goal_id FROM savings_allocations s WHERE s.transaction_id = t.id) AS savingsGoalId
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts ta ON ta.id = t.to_account_id
  LEFT JOIN categories c ON c.id = t.category_id`;

async function listTransactions(db, monthValue) {
  const { start, end } = parseMonth(monthValue);
  return db.query(`${TX_SELECT} WHERE t.date >= @start AND t.date < @end ORDER BY t.date DESC, t.id DESC`, {
    start,
    end,
  });
}

async function getTransaction(db, id) {
  const rows = await db.query(`${TX_SELECT} WHERE t.id = @id`, { id });
  return rows[0] || null;
}

/** 入力を検証し、種別ごとの形（ck_tx_shape と同じ規則）に整える */
function parseTransactionBody(body) {
  const obj = requireObject(body);
  const type = parseEnum(obj.type, TX_TYPES, 'type');
  const date = parseDate(obj.date);
  const amount = parseAmount(obj.amount);
  const memo = parseMemo(obj.memo);
  const accountId = parseId(obj.accountId, 'accountId');

  if (type === 'transfer') {
    const toAccountId = parseId(obj.toAccountId, 'toAccountId');
    if (isPresent(obj.categoryId)) throw badRequest('振替にカテゴリは指定できません');
    if (toAccountId === accountId) throw badRequest('振替元と振替先には別の口座を指定してください');
    return { type, date, amount, memo, accountId, toAccountId, categoryId: null };
  }

  if (isPresent(obj.toAccountId)) throw badRequest('振替先（toAccountId）は振替のときだけ指定できます');
  const categoryId = parseId(obj.categoryId, 'categoryId');
  return { type, date, amount, memo, accountId, toAccountId: null, categoryId };
}

async function assertAccountUsable(db, id, field, unchangedId) {
  const rows = await db.query('SELECT is_archived AS isArchived FROM accounts WHERE id = @id', { id });
  if (rows.length === 0) throw badRequest(`${field}: 指定された口座が存在しません`);
  // 編集時、元の取引が使っているアーカイブ済みの口座は、そのまま残してよい
  if (rows[0].isArchived && id !== unchangedId) throw badRequest(`${field}: アーカイブ済みの口座は指定できません`);
}

/**
 * 参照先（口座・カテゴリ）の存在、アーカイブ済みでないこと、
 * カテゴリの種別と取引の種別の一致を確認する。
 * existing（編集前の取引）があれば、変更していない参照は許可する。
 */
async function assertReferences(db, input, existing) {
  await assertAccountUsable(db, input.accountId, 'accountId', existing ? existing.accountId : null);
  if (input.toAccountId !== null) {
    await assertAccountUsable(db, input.toAccountId, 'toAccountId', existing ? existing.toAccountId : null);
  }
  if (input.categoryId !== null) {
    const rows = await db.query('SELECT type, is_archived AS isArchived FROM categories WHERE id = @id', {
      id: input.categoryId,
    });
    if (rows.length === 0) throw badRequest('categoryId: 指定されたカテゴリが存在しません');
    if (rows[0].type !== input.type) throw badRequest('カテゴリの種別と取引の種別が一致しません');
    if (rows[0].isArchived && input.categoryId !== (existing ? existing.categoryId : null)) {
      throw badRequest('categoryId: 削除済みのカテゴリは指定できません');
    }
  }
}

/** 取引を 1 件追加して新しい ID を返す（検証済みの入力が前提） */
async function insertTransaction(db, input) {
  const rows = await db.query(
    `INSERT INTO transactions (date, type, account_id, to_account_id, category_id, amount, memo)
     OUTPUT INSERTED.id AS id
     VALUES (@date, @type, @accountId, @toAccountId, @categoryId, @amount, @memo)`,
    input,
  );
  return rows[0].id;
}

async function createTransaction(db, body) {
  const input = parseTransactionBody(body);
  await assertReferences(db, input, null);
  const id = await insertTransaction(db, input);
  return getTransaction(db, id);
}

async function updateTransaction(db, id, body) {
  const existing = await getTransaction(db, id);
  if (!existing) throw notFound('取引が見つかりません');
  const input = parseTransactionBody(body);

  // 「この貯金で支払う」で登録した取引は、割当解除と金額が対になっているため金額・種別を変えられない
  if (existing.savingsGoalId != null && (input.type !== existing.type || input.amount !== existing.amount)) {
    throw conflict('貯金で支払った取引の金額・種別は変更できません。削除して登録し直してください');
  }

  await assertReferences(db, input, existing);
  await db.execute(
    `UPDATE transactions
     SET date = @date, type = @type, account_id = @accountId, to_account_id = @toAccountId,
         category_id = @categoryId, amount = @amount, memo = @memo, updated_at = SYSUTCDATETIME()
     WHERE id = @id`,
    { ...input, id },
  );
  return getTransaction(db, id);
}

/** 削除。この貯金で支払った取引なら、対応する割当解除も ON DELETE CASCADE で一緒に消える。 */
async function deleteTransaction(db, id) {
  const existing = await getTransaction(db, id);
  if (!existing) throw notFound('取引が見つかりません');
  await db.execute('DELETE FROM transactions WHERE id = @id', { id });
}

module.exports = {
  TX_TYPES,
  TX_SELECT,
  listTransactions,
  getTransaction,
  parseTransactionBody,
  assertReferences,
  insertTransaction,
  createTransaction,
  updateTransaction,
  deleteTransaction,
};
