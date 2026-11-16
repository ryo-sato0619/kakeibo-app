'use strict';

const { requireObject, parseName, parseEnum, parseSortOrder, isPresent } = require('../lib/validate');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { nextSortOrder, updateRow } = require('./common');

const CATEGORY_TYPES = ['income', 'expense'];

const CATEGORY_SELECT = `
  SELECT id, type, name, sort_order AS sortOrder, is_archived AS isArchived
  FROM categories`;

async function listCategories(db, { type, includeArchived = false } = {}) {
  const where = [];
  const params = {};
  if (type) {
    params.type = parseEnum(type, CATEGORY_TYPES, 'type');
    where.push('type = @type');
  }
  if (!includeArchived) where.push('is_archived = 0');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.query(`${CATEGORY_SELECT} ${clause} ORDER BY type, sort_order, id`, params);
}

async function getCategory(db, id) {
  const rows = await db.query(`${CATEGORY_SELECT} WHERE id = @id`, { id });
  return rows[0] || null;
}

/**
 * 追加。同じ種別・同じ名前のアーカイブ済みカテゴリがあるときは、新規作成せず復活させる
 * （種別内の名称重複は UNIQUE 制約で禁止されているため）。
 */
async function createCategory(db, body) {
  const obj = requireObject(body);
  const type = parseEnum(obj.type, CATEGORY_TYPES, 'type');
  const name = parseName(obj.name);
  const sortOrder = isPresent(obj.sortOrder)
    ? parseSortOrder(obj.sortOrder)
    : await nextSortOrder(db, 'categories', { type });

  const same = await db.query('SELECT id, is_archived AS isArchived FROM categories WHERE type = @type AND name = @name', {
    type,
    name,
  });
  if (same.length > 0) {
    if (!same[0].isArchived) throw conflict('同じ名前のカテゴリが既にあります');
    await db.execute('UPDATE categories SET is_archived = 0, sort_order = @sortOrder WHERE id = @id', {
      id: same[0].id,
      sortOrder,
    });
    return getCategory(db, same[0].id);
  }

  const rows = await db.query(
    `INSERT INTO categories (type, name, sort_order)
     OUTPUT INSERTED.id AS id
     VALUES (@type, @name, @sortOrder)`,
    { type, name, sortOrder },
  );
  return getCategory(db, rows[0].id);
}

async function updateCategory(db, id, body) {
  const obj = requireObject(body);
  const existing = await getCategory(db, id);
  if (!existing) throw notFound('カテゴリが見つかりません');
  if (existing.isArchived) throw conflict('削除済みのカテゴリは編集できません');
  if (obj.type !== undefined && obj.type !== existing.type) throw badRequest('カテゴリの種別は変更できません');

  const sets = {};
  if (obj.name !== undefined) {
    const name = parseName(obj.name);
    const dup = await db.query('SELECT id FROM categories WHERE type = @type AND name = @name AND id <> @id', {
      type: existing.type,
      name,
      id,
    });
    if (dup.length > 0) throw conflict('同じ名前のカテゴリが既にあります');
    sets.name = name;
  }
  if (obj.sortOrder !== undefined) sets.sort_order = parseSortOrder(obj.sortOrder);
  if (Object.keys(sets).length === 0) throw badRequest('更新する項目がありません');

  await updateRow(db, 'categories', id, sets);
  return getCategory(db, id);
}

/** 論理削除。過去の取引の表示・集計には引き続き使われる。 */
async function archiveCategory(db, id) {
  const existing = await getCategory(db, id);
  if (!existing || existing.isArchived) throw notFound('カテゴリが見つかりません');
  await db.execute('UPDATE categories SET is_archived = 1 WHERE id = @id', { id });
}

module.exports = {
  CATEGORY_TYPES,
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  archiveCategory,
};
