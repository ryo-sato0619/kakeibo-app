'use strict';

const {
  requireObject,
  parseName,
  parseEnum,
  parseOpeningBalance,
  parseSortOrder,
  isPresent,
} = require('../lib/validate');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { nextSortOrder, updateRow } = require('./common');

const ACCOUNT_KINDS = ['bank', 'cash', 'emoney', 'credit'];

// 残高は保存せず、ビュー v_account_balances（初期残高 + 取引の合計）で計算する
const ACCOUNT_SELECT = `
  SELECT b.id, b.name, b.kind, a.opening_balance AS openingBalance,
         b.sort_order AS sortOrder, b.is_archived AS isArchived, b.balance
  FROM v_account_balances b
  JOIN accounts a ON a.id = b.id`;

async function listAccounts(db, { includeArchived = false } = {}) {
  const where = includeArchived ? '' : 'WHERE b.is_archived = 0';
  return db.query(`${ACCOUNT_SELECT} ${where} ORDER BY b.sort_order, b.id`);
}

async function getAccount(db, id) {
  const rows = await db.query(`${ACCOUNT_SELECT} WHERE b.id = @id`, { id });
  return rows[0] || null;
}

async function createAccount(db, body) {
  const obj = requireObject(body);
  const name = parseName(obj.name);
  const kind = parseEnum(obj.kind, ACCOUNT_KINDS, 'kind');
  const openingBalance = isPresent(obj.openingBalance) ? parseOpeningBalance(obj.openingBalance) : 0;
  const sortOrder = isPresent(obj.sortOrder) ? parseSortOrder(obj.sortOrder) : await nextSortOrder(db, 'accounts');

  const rows = await db.query(
    `INSERT INTO accounts (name, kind, opening_balance, sort_order)
     OUTPUT INSERTED.id AS id
     VALUES (@name, @kind, @openingBalance, @sortOrder)`,
    { name, kind, openingBalance, sortOrder },
  );
  return getAccount(db, rows[0].id);
}

async function updateAccount(db, id, body) {
  const obj = requireObject(body);
  const existing = await getAccount(db, id);
  if (!existing) throw notFound('口座が見つかりません');
  if (existing.isArchived) throw conflict('アーカイブ済みの口座は編集できません');

  const sets = {};
  if (obj.name !== undefined) sets.name = parseName(obj.name);
  if (obj.kind !== undefined) sets.kind = parseEnum(obj.kind, ACCOUNT_KINDS, 'kind');
  if (obj.openingBalance !== undefined) sets.opening_balance = parseOpeningBalance(obj.openingBalance);
  if (obj.sortOrder !== undefined) sets.sort_order = parseSortOrder(obj.sortOrder);
  if (Object.keys(sets).length === 0) throw badRequest('更新する項目がありません');

  await updateRow(db, 'accounts', id, sets);
  return getAccount(db, id);
}

/** 残高が 0 の口座だけをアーカイブ（論理削除）できる */
async function archiveAccount(db, id) {
  const existing = await getAccount(db, id);
  if (!existing || existing.isArchived) throw notFound('口座が見つかりません');
  if (existing.balance !== 0) {
    throw conflict('残高が 0 の口座のみアーカイブできます。先に振替などで残高を 0 にしてください');
  }
  await db.execute('UPDATE accounts SET is_archived = 1 WHERE id = @id', { id });
}

module.exports = { ACCOUNT_KINDS, listAccounts, getAccount, createAccount, updateAccount, archiveAccount };
