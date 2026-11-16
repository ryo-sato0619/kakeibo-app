'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const categories = require('../src/services/categories');
const { createFakeDb, scripted } = require('./helpers/fakeDb');

const cat = (over = {}) => ({ id: 1, type: 'expense', name: '食費', sortOrder: 10, isArchived: false, ...over });

describe('カテゴリ', () => {
  it('追加：同じ種別・同じ名前が有効なら 409', async () => {
    const db = createFakeDb(scripted([['WHERE type = @type AND name = @name', [{ id: 1, isArchived: false }]], ['MAX(sort_order)', [{ n: 130 }]]]));
    await assert.rejects(categories.createCategory(db, { type: 'expense', name: '食費' }), (e) => e.status === 409);
    assert.equal(db.writes().length, 0);
  });

  it('追加：同名のアーカイブ済みがあれば、新規作成せず復活させる', async () => {
    const db = createFakeDb(
      scripted([
        ['WHERE type = @type AND name = @name', [{ id: 7, isArchived: true }]],
        ['MAX(sort_order)', [{ n: 130 }]],
        ['FROM categories WHERE id = @id', [cat({ id: 7, name: '食費', sortOrder: 130 })]],
      ]),
    );
    const restored = await categories.createCategory(db, { type: 'expense', name: '食費' });
    assert.equal(restored.id, 7);
    const w = db.writes();
    assert.equal(w.length, 1);
    assert.match(w[0].sql, /UPDATE categories SET is_archived = 0/);
  });

  it('追加：新規は種別・名前を検証して INSERT、表示順は「その他(999)」の前に入る', async () => {
    const db = createFakeDb(
      scripted([
        ['MAX(sort_order)', [{ n: 130 }]],
        ['INSERT INTO categories', [{ id: 20 }]],
        ['FROM categories WHERE id = @id', [cat({ id: 20, name: 'ペット', sortOrder: 130 })]],
      ]),
    );
    await categories.createCategory(db, { type: 'expense', name: 'ペット' });
    const sortQuery = db.calls.find((c) => c.sql.includes('MAX(sort_order)'));
    assert.match(sortQuery.sql, /sort_order < 900/);
    await assert.rejects(categories.createCategory(db, { type: 'transfer', name: 'x' }), (e) => e.status === 400);
  });

  it('編集：種別は変えられない・同名への変更は 409・名前と並び順は更新できる', async () => {
    const base = scripted([['FROM categories WHERE id = @id', [cat()]]]);
    await assert.rejects(categories.updateCategory(createFakeDb(base), 1, { type: 'income' }), (e) => e.status === 400);

    const dupDb = createFakeDb(scripted([['FROM categories WHERE id = @id', [cat()]], ['AND id <> @id', [{ id: 2 }]]]));
    await assert.rejects(categories.updateCategory(dupDb, 1, { name: '日用品' }), (e) => e.status === 409);

    const db = createFakeDb(base);
    await categories.updateCategory(db, 1, { name: '食料品', sortOrder: 5 });
    assert.match(db.writes()[0].sql, /SET name = @p0, sort_order = @p1 WHERE id = @id/);
  });

  it('削除：論理削除（is_archived = 1）。存在しない・削除済みは 404', async () => {
    const db = createFakeDb(scripted([['FROM categories WHERE id = @id', [cat()]]]));
    await categories.archiveCategory(db, 1);
    assert.match(db.writes()[0].sql, /^UPDATE categories SET is_archived = 1/);
    await assert.rejects(categories.archiveCategory(createFakeDb(), 1), (e) => e.status === 404);
    const gone = createFakeDb(scripted([['FROM categories WHERE id = @id', [cat({ isArchived: true })]]]));
    await assert.rejects(categories.archiveCategory(gone, 1), (e) => e.status === 404);
  });

  it('一覧：種別が不正なら 400。既定ではアーカイブ済みを除く', async () => {
    const db = createFakeDb();
    await assert.rejects(categories.listCategories(db, { type: 'x' }), (e) => e.status === 400);
    await categories.listCategories(db, { type: 'income' });
    assert.match(db.calls[0].sql, /WHERE type = @type AND is_archived = 0/);
  });
});
