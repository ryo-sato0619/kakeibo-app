'use strict';

const { app } = require('@azure/functions');
const { route, ok, created, noContent } = require('../lib/http');
const { parseId, isPresent } = require('../lib/validate');
const { badRequest } = require('../lib/errors');
const transactions = require('../services/transactions');

// GET /api/transactions?month=YYYY-MM / POST /api/transactions
app.http('transactionsCollection', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'transactions',
  handler: route({
    GET: async ({ db, query }) => {
      const month = query.get('month');
      if (!isPresent(month)) throw badRequest('month（YYYY-MM）を指定してください');
      return ok(await transactions.listTransactions(db, month));
    },
    POST: async ({ db, readJson }) => created(await transactions.createTransaction(db, await readJson())),
  }),
});

// PUT /api/transactions/{id} / DELETE /api/transactions/{id}
app.http('transactionItem', {
  methods: ['PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'transactions/{id}',
  handler: route({
    PUT: async ({ db, params, readJson }) =>
      ok(await transactions.updateTransaction(db, parseId(params.id), await readJson())),
    DELETE: async ({ db, params }) => {
      await transactions.deleteTransaction(db, parseId(params.id));
      return noContent();
    },
  }),
});
