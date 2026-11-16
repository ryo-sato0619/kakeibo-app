'use strict';

const { app } = require('@azure/functions');
const { route, ok } = require('../lib/http');
const { getSummary } = require('../services/summary');

// GET /api/summary … 総資産・貯金割当合計・使えるお金、口座ごとの残高
app.http('summary', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'summary',
  handler: route({
    GET: async ({ db }) => ok(await getSummary(db)),
  }),
});
