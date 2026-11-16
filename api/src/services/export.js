'use strict';

const { parseDate, isPresent } = require('../lib/validate');
const { badRequest } = require('../lib/errors');
const { todayJst, formatJstDateTime } = require('../lib/dates');
const { TX_SELECT } = require('./transactions');

const TYPE_LABEL = { income: '入金', expense: '出金', transfer: '振替' };
const HEADERS = ['ID', '日付', '種別', '口座', '振替先口座', 'カテゴリ', '金額', 'メモ', '登録日時(JST)', '更新日時(JST)'];

/**
 * CSV の 1 セル。カンマ・引用符・改行を含むときは "..." で囲む。
 * text = true の列は、Excel で数式として実行されないよう、先頭が = + - @ のとき ' を前置する。
 */
function csvCell(value, { text = false } = {}) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildTransactionsCsv(rows) {
  const lines = [HEADERS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.id),
        csvCell(r.date),
        csvCell(TYPE_LABEL[r.type] || r.type),
        csvCell(r.accountName, { text: true }),
        csvCell(r.toAccountName, { text: true }),
        csvCell(r.categoryName, { text: true }),
        csvCell(r.amount),
        csvCell(r.memo, { text: true }),
        csvCell(formatJstDateTime(r.createdAt)),
        csvCell(formatJstDateTime(r.updatedAt)),
      ].join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** 期間（from / to、どちらも省略可・両端を含む）の取引を CSV にする */
async function exportTransactions(db, { from, to } = {}, opts) {
  const fromDate = isPresent(from) && from !== '' ? parseDate(from, 'from') : null;
  const toDate = isPresent(to) && to !== '' ? parseDate(to, 'to') : null;
  if (fromDate && toDate && fromDate > toDate) throw badRequest('from は to 以前の日付を指定してください');

  const rows = await db.query(
    `${TX_SELECT}
     WHERE (@from IS NULL OR t.date >= @from) AND (@to IS NULL OR t.date <= @to)
     ORDER BY t.date, t.id`,
    { from: fromDate, to: toDate },
  );
  const stamp = todayJst(opts && opts.now ? opts.now() : Date.now()).replace(/-/g, '');
  return { filename: `transactions_${stamp}.csv`, content: buildTransactionsCsv(rows) };
}

module.exports = { buildTransactionsCsv, exportTransactions, csvCell };
