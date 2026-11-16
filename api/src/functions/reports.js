'use strict';

const { app } = require('@azure/functions');
const { route, ok } = require('../lib/http');
const { isPresent } = require('../lib/validate');
const { badRequest } = require('../lib/errors');
const reports = require('../services/reports');

// GET /api/reports/monthly?month=YYYY-MM
app.http('reportsMonthly', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/monthly',
  handler: route({
    GET: async ({ db, query }) => {
      const month = query.get('month');
      if (!isPresent(month)) throw badRequest('month（YYYY-MM）を指定してください');
      return ok(await reports.monthlyReport(db, month));
    },
  }),
});

// GET /api/reports/yearly?year=YYYY
app.http('reportsYearly', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/yearly',
  handler: route({
    GET: async ({ db, query }) => {
      const year = query.get('year');
      if (!isPresent(year)) throw badRequest('year（YYYY）を指定してください');
      return ok(await reports.yearlyReport(db, year));
    },
  }),
});
