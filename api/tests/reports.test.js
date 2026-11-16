'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { monthlyReport, yearlyReport } = require('../src/services/reports');
const { buildTransactionsCsv, exportTransactions, csvCell } = require('../src/services/export');
const { createFakeDb, scripted } = require('./helpers/fakeDb');

describe('月次レポート', () => {
  it('収入・支出の合計と、カテゴリ別の内訳を返す（収支 = 収入 − 支出）', async () => {
    const db = createFakeDb(
      scripted([
        ['GROUP BY t.type', [
          { type: 'income', categoryId: 10, categoryName: '給与', amount: 300000 },
          { type: 'expense', categoryId: 1, categoryName: '食費', amount: 45000 },
          { type: 'expense', categoryId: 2, categoryName: '日用品', amount: 5000 },
        ]],
      ]),
    );
    const r = await monthlyReport(db, '2026-11');
    assert.equal(r.month, '2026-11');
    assert.equal(r.income, 300000);
    assert.equal(r.expense, 50000);
    assert.equal(r.net, 250000);
    assert.deepEqual(r.expenseByCategory.map((c) => c.categoryName), ['食費', '日用品']);
    assert.deepEqual(db.calls[0].params, { start: '2026-11-01', end: '2026-12-01' });
    // 振替は集計に含めない（SQL 側で income / expense のみ）
    assert.match(db.calls[0].sql, /t\.type IN \('income', 'expense'\)/);
  });

  it('取引がない月は 0 と空の内訳', async () => {
    const r = await monthlyReport(createFakeDb(), '2026-01');
    assert.deepEqual([r.income, r.expense, r.net], [0, 0, 0]);
    assert.deepEqual(r.expenseByCategory, []);
  });

  it('月の形式が不正なら 400', async () => {
    await assert.rejects(monthlyReport(createFakeDb(), '2026-13'), (e) => e.status === 400);
  });
});

describe('年次レポート', () => {
  it('取引のない月も含めて 12 か月分を返す', async () => {
    const db = createFakeDb(
      scripted([
        ['GROUP BY MONTH', [
          { month: 1, type: 'income', amount: 300000 },
          { month: 1, type: 'expense', amount: 120000 },
          { month: 3, type: 'expense', amount: 80000 },
        ]],
      ]),
    );
    const r = await yearlyReport(db, '2026');
    assert.equal(r.months.length, 12);
    assert.deepEqual(r.months[0], { month: '2026-01', income: 300000, expense: 120000, net: 180000 });
    assert.deepEqual(r.months[1], { month: '2026-02', income: 0, expense: 0, net: 0 });
    assert.deepEqual(r.months[2], { month: '2026-03', income: 0, expense: 80000, net: -80000 });
    assert.equal(r.months[11].month, '2026-12');
    assert.equal(r.income, 300000);
    assert.equal(r.expense, 200000);
    assert.equal(r.net, 100000);
    assert.deepEqual(db.calls[0].params, { start: '2026-01-01', end: '2027-01-01' });
  });
});

describe('CSV エクスポート', () => {
  const sample = {
    id: 1, date: '2026-11-08', type: 'expense', accountName: '現金', toAccountName: null, categoryName: '食費',
    amount: 1200, memo: 'ランチ, "定食"', createdAt: new Date(Date.UTC(2026, 10, 8, 3, 0, 0)), updatedAt: null,
  };

  it('ヘッダー行・日本語の種別・JST の日時で出力し、CRLF で改行する', () => {
    const csv = buildTransactionsCsv([sample, { ...sample, id: 2, type: 'transfer', toAccountName: '銀行', categoryName: null, memo: null }]);
    const lines = csv.split('\r\n');
    assert.equal(lines[0], 'ID,日付,種別,口座,振替先口座,カテゴリ,金額,メモ,登録日時(JST),更新日時(JST)');
    assert.equal(lines[1], '1,2026-11-08,出金,現金,,食費,1200,"ランチ, ""定食""",2026-11-08 12:00:00,');
    assert.equal(lines[2], '2,2026-11-08,振替,現金,銀行,,1200,,2026-11-08 12:00:00,');
    assert.equal(lines[3], '');
  });

  it('セルのエスケープ：カンマ・引用符・改行は囲む。= + - @ で始まる文字列は数式として実行されないよう保護する', () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('1行目\n2行目'), '"1行目\n2行目"');
    assert.equal(csvCell('=SUM(A1:A3)', { text: true }), "'=SUM(A1:A3)");
    assert.equal(csvCell('@cmd', { text: true }), "'@cmd");
    assert.equal(csvCell(-500), '-500'); // 数値列は保護しない
    assert.equal(csvCell(null), '');
  });

  it('期間指定：from / to を検証し、逆転は 400。省略すれば全期間', async () => {
    const db = createFakeDb(scripted([['FROM transactions t', [sample]]]));
    const out = await exportTransactions(db, { from: '2026-11-01', to: '2026-11-30' }, { now: () => Date.UTC(2026, 10, 8, 3, 0, 0) });
    assert.equal(out.filename, 'transactions_20261108.csv');
    assert.deepEqual(db.calls[0].params, { from: '2026-11-01', to: '2026-11-30' });
    assert.match(db.calls[0].sql, /ORDER BY t\.date, t\.id/);

    const all = createFakeDb();
    await exportTransactions(all, { from: null, to: null });
    assert.deepEqual(all.calls[0].params, { from: null, to: null });

    await assert.rejects(exportTransactions(createFakeDb(), { from: '2026-12-01', to: '2026-11-01' }), (e) => e.status === 400);
    await assert.rejects(exportTransactions(createFakeDb(), { from: '2026/11/01' }), (e) => e.status === 400);
  });
});
