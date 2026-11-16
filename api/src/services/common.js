'use strict';

// テーブル名・列名はすべてコード内の定数（利用者の入力は SQL に埋め込まない）。
const NEXT_SORT_SQL = {
  accounts: 'SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM accounts',
  savings_goals: 'SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM savings_goals',
  // 「その他」(999) より前に新しい項目が並ぶよう、900 以上は数えない
  categories: 'SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM categories WHERE type = @type AND sort_order < 900',
};

/** 新規登録時の表示順の既定値（現在の最大値 + 10） */
async function nextSortOrder(db, table, params) {
  const rows = await db.query(NEXT_SORT_SQL[table], params);
  return rows[0].n;
}

/** sets = { 列名: 値 } で UPDATE する。touchUpdatedAt で updated_at も更新。 */
async function updateRow(db, table, id, sets, { touchUpdatedAt = false } = {}) {
  const columns = Object.keys(sets);
  const assignments = columns.map((c, i) => `${c} = @p${i}`);
  if (touchUpdatedAt) assignments.push('updated_at = SYSUTCDATETIME()');
  const params = { id };
  columns.forEach((c, i) => {
    params[`p${i}`] = sets[c];
  });
  return db.execute(`UPDATE ${table} SET ${assignments.join(', ')} WHERE id = @id`, params);
}

module.exports = { nextSortOrder, updateRow };
