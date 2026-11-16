'use strict';

const { app } = require('@azure/functions');
const { route, ok, created, noContent } = require('../lib/http');
const { parseId } = require('../lib/validate');
const categories = require('../services/categories');

// GET /api/categories（?type=income|expense、?includeArchived=1）/ POST /api/categories
app.http('categoriesCollection', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'categories',
  handler: route({
    GET: async ({ db, query }) =>
      ok(
        await categories.listCategories(db, {
          type: query.get('type') || undefined,
          includeArchived: query.get('includeArchived') === '1',
        }),
      ),
    POST: async ({ db, readJson }) => created(await categories.createCategory(db, await readJson())),
  }),
});

// PUT /api/categories/{id}（名称変更・並べ替え）/ DELETE /api/categories/{id}（論理削除）
app.http('categoryItem', {
  methods: ['PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'categories/{id}',
  handler: route({
    PUT: async ({ db, params, readJson }) =>
      ok(await categories.updateCategory(db, parseId(params.id), await readJson())),
    DELETE: async ({ db, params }) => {
      await categories.archiveCategory(db, parseId(params.id));
      return noContent();
    },
  }),
});
