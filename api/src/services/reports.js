'use strict';

const { parseMonth, parseYear } = require('../lib/validate');

const sum = (items) => items.reduce((total, item) => total + item.amount, 0);

/** 月次：収入・支出の合計とカテゴリ別内訳（振替は含めない） */
async function monthlyReport(db, monthValue) {
  const { month, start, end } = parseMonth(monthValue);
  const rows = await db.query(
    `SELECT t.type, t.category_id AS categoryId, c.name AS categoryName, SUM(t.amount) AS amount
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     WHERE t.date >= @start AND t.date < @end AND t.type IN ('income', 'expense')
     GROUP BY t.type, t.category_id, c.name
     ORDER BY SUM(t.amount) DESC, t.category_id`,
    { start, end },
  );
  const pick = (type) =>
    rows.filter((r) => r.type === type).map(({ categoryId, categoryName, amount }) => ({ categoryId, categoryName, amount }));
  const incomeByCategory = pick('income');
  const expenseByCategory = pick('expense');
  const income = sum(incomeByCategory);
  const expense = sum(expenseByCategory);
  return { month, income, expense, net: income - expense, incomeByCategory, expenseByCategory };
}

/** 年次：1〜12 月の収入・支出・収支（取引のない月も 0 で返す） */
async function yearlyReport(db, yearValue) {
  const year = parseYear(yearValue);
  const rows = await db.query(
    `SELECT MONTH(t.date) AS month, t.type, SUM(t.amount) AS amount
     FROM transactions t
     WHERE t.date >= @start AND t.date < @end AND t.type IN ('income', 'expense')
     GROUP BY MONTH(t.date), t.type`,
    { start: `${year}-01-01`, end: `${year + 1}-01-01` },
  );
  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    const income = sum(rows.filter((r) => r.month === m && r.type === 'income'));
    const expense = sum(rows.filter((r) => r.month === m && r.type === 'expense'));
    months.push({ month: `${year}-${String(m).padStart(2, '0')}`, income, expense, net: income - expense });
  }
  const income = sum(months.map((m) => ({ amount: m.income })));
  const expense = sum(months.map((m) => ({ amount: m.expense })));
  return { year, income, expense, net: income - expense, months };
}

module.exports = { monthlyReport, yearlyReport };
