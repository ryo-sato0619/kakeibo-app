'use strict';

const { app } = require('@azure/functions');
const { route, ok, created, noContent } = require('../lib/http');
const { parseId } = require('../lib/validate');
const savings = require('../services/savings');

// GET /api/savings（?includeArchived=1）/ POST /api/savings
app.http('savingsCollection', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'savings',
  handler: route({
    GET: async ({ db, query }) => ok(await savings.listGoals(db, { includeArchived: query.get('includeArchived') === '1' })),
    POST: async ({ db, readJson }) => created(await savings.createGoal(db, await readJson())),
  }),
});

// PUT /api/savings/{id} / DELETE /api/savings/{id}（アーカイブ。残額は自動解除）
app.http('savingsItem', {
  methods: ['PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'savings/{id}',
  handler: route({
    PUT: async ({ db, params, readJson }) => ok(await savings.updateGoal(db, parseId(params.id), await readJson())),
    DELETE: async ({ db, params }) => {
      await savings.archiveGoal(db, parseId(params.id));
      return noContent();
    },
  }),
});

// GET /api/savings/{id}/allocations / POST /api/savings/{id}/allocations（amount の正負で割当・解除）
app.http('savingsAllocations', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'savings/{id}/allocations',
  handler: route({
    GET: async ({ db, params }) => ok(await savings.listAllocations(db, parseId(params.id))),
    POST: async ({ db, params, readJson }) =>
      created(await savings.createAllocation(db, parseId(params.id), await readJson())),
  }),
});

// POST /api/savings/{id}/spend … この貯金で支払う（出金登録 + 同額の割当解除を同一トランザクションで）
app.http('savingsSpend', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'savings/{id}/spend',
  handler: route({
    POST: async ({ db, params, readJson }) =>
      created(await savings.spendFromGoal(db, parseId(params.id), await readJson())),
  }),
});
