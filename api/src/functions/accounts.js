'use strict';

const { app } = require('@azure/functions');
const { route, ok, created, noContent } = require('../lib/http');
const { parseId } = require('../lib/validate');
const accounts = require('../services/accounts');

// GET /api/accounts（?includeArchived=1 でアーカイブ済みも）/ POST /api/accounts
app.http('accountsCollection', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'accounts',
  handler: route({
    GET: async ({ db, query }) => ok(await accounts.listAccounts(db, { includeArchived: query.get('includeArchived') === '1' })),
    POST: async ({ db, readJson }) => created(await accounts.createAccount(db, await readJson())),
  }),
});

// PUT /api/accounts/{id} / DELETE /api/accounts/{id}（アーカイブ。残高 0 のみ）
app.http('accountItem', {
  methods: ['PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'accounts/{id}',
  handler: route({
    PUT: async ({ db, params, readJson }) => ok(await accounts.updateAccount(db, parseId(params.id), await readJson())),
    DELETE: async ({ db, params }) => {
      await accounts.archiveAccount(db, parseId(params.id));
      return noContent();
    },
  }),
});
