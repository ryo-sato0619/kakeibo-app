'use strict';

const { app } = require('@azure/functions');
const { route, csvResponse } = require('../lib/http');
const { exportTransactions } = require('../services/export');

// GET /api/export/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD … 取引の CSV（UTF-8 BOM 付き）
app.http('exportTransactions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'export/transactions',
  handler: route({
    GET: async ({ db, query }) => {
      const { filename, content } = await exportTransactions(db, { from: query.get('from'), to: query.get('to') });
      return csvResponse(content, filename);
    },
  }),
});
