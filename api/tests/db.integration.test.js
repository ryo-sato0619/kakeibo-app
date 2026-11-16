'use strict';

/**
 * 実際の Azure SQL Database に対する結合テスト（既定ではスキップ）。
 *   npm run test:db   … RUN_DB_TESTS=1 で実行
 *
 * 接続先は SQL_CONNECTION_STRING（環境変数、または api/local.settings.json）。
 * すべてのテストは 1 つのトランザクション内で行い、最後に必ず ROLLBACK するため、
 * 本番データには何も残らない（ID の採番だけが進む）。
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RUN = process.env.RUN_DB_TESTS === '1';

function loadConnectionString() {
  if (process.env.SQL_CONNECTION_STRING) return;
  const file = path.join(__dirname, '..', 'local.settings.json');
  if (fs.existsSync(file)) {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (settings.Values && settings.Values.SQL_CONNECTION_STRING) {
      process.env.SQL_CONNECTION_STRING = settings.Values.SQL_CONNECTION_STRING;
    }
  }
}

class Rollback extends Error {}

/** fn を 1 つのトランザクションで実行し、必ず ROLLBACK する（fn 内のアサーション失敗はそのまま伝える） */
async function inRolledBackTx(db, fn) {
  try {
    await db.transaction(async (tx) => {
      // サービス内の db.transaction() も同じトランザクションに参加させる
      const joined = { query: tx.query, execute: tx.execute, transaction: (inner) => inner(joined) };
      await fn(joined);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
}

describe('Azure SQL 結合テスト（ロールバック）', { skip: !RUN && '既定ではスキップ（npm run test:db で実行）' }, () => {
  loadConnectionString();
  const { getDb } = require('../src/lib/db');
  const accounts = require('../src/services/accounts');
  const tx = require('../src/services/transactions');
  const savings = require('../src/services/savings');
  const { getSummary } = require('../src/services/summary');
  const reports = require('../src/services/reports');
  const db = getDb();

  after(async () => {
    // プールを閉じてプロセスを終了できるようにする
    const sql = require('mssql');
    await sql.close().catch(() => {});
    setTimeout(() => process.exit(process.exitCode || 0), 100).unref();
  });

  async function seedMasters(t) {
    const a = await accounts.createAccount(t, { name: '__test_bank__', kind: 'bank', openingBalance: 10000 });
    const b = await accounts.createAccount(t, { name: '__test_cash__', kind: 'cash', openingBalance: 0 });
    const c = await accounts.createAccount(t, { name: '__test_credit__', kind: 'credit', openingBalance: 0 });
    const inc = await t.query("INSERT INTO categories (type, name) OUTPUT INSERTED.id AS id VALUES ('income', N'__test_income__')");
    const exp = await t.query("INSERT INTO categories (type, name) OUTPUT INSERTED.id AS id VALUES ('expense', N'__test_expense__')");
    return { a, b, c, incomeId: inc[0].id, expenseId: exp[0].id };
  }
  const balanceOf = async (t, id) => (await accounts.getAccount(t, id)).balance;

  it('残高 = 初期残高 + 入金 − 出金 ± 振替（口座ごと・合計）', async () => {
    await inRolledBackTx(db, async (t) => {
      const { a, b, c, incomeId, expenseId } = await seedMasters(t);
      const base = { date: '2026-11-08' };
      await tx.createTransaction(t, { ...base, type: 'income', accountId: a.id, categoryId: incomeId, amount: 5000 });
      await tx.createTransaction(t, { ...base, type: 'expense', accountId: a.id, categoryId: expenseId, amount: 1200 });
      await tx.createTransaction(t, { ...base, type: 'transfer', accountId: a.id, toAccountId: b.id, amount: 3000 });
      await tx.createTransaction(t, { ...base, type: 'expense', accountId: c.id, categoryId: expenseId, amount: 800 });

      assert.equal(await balanceOf(t, a.id), 10000 + 5000 - 1200 - 3000); // 10800
      assert.equal(await balanceOf(t, b.id), 3000); // 振替の受け取り側
      assert.equal(await balanceOf(t, c.id), -800); // クレジットカードはマイナス
      // 振替は口座間の移動なので、3 口座の合計は「初期残高 + 入金 − 出金」だけで決まる
      const total = (await balanceOf(t, a.id)) + (await balanceOf(t, b.id)) + (await balanceOf(t, c.id));
      assert.equal(total, 10000 + 5000 - 1200 - 800);
    });
  });

  it('取引の編集・削除が残高に反映される', async () => {
    await inRolledBackTx(db, async (t) => {
      const { a, b, expenseId } = await seedMasters(t);
      const e = await tx.createTransaction(t, { date: '2026-11-08', type: 'expense', accountId: a.id, categoryId: expenseId, amount: 1000 });
      assert.equal(await balanceOf(t, a.id), 9000);
      await tx.updateTransaction(t, e.id, { date: '2026-11-08', type: 'expense', accountId: b.id, categoryId: expenseId, amount: 400 });
      assert.equal(await balanceOf(t, a.id), 10000);
      assert.equal(await balanceOf(t, b.id), -400);
      await tx.deleteTransaction(t, e.id);
      assert.equal(await balanceOf(t, b.id), 0);
    });
  });

  it('残高のある口座はアーカイブできず、0 にすればできる', async () => {
    await inRolledBackTx(db, async (t) => {
      const { a, b } = await seedMasters(t);
      await assert.rejects(accounts.archiveAccount(t, a.id), (e) => e.status === 409);
      await tx.createTransaction(t, { date: '2026-11-08', type: 'transfer', accountId: a.id, toAccountId: b.id, amount: 10000 });
      await accounts.archiveAccount(t, a.id); // 残高 0 になったので可能
      assert.equal((await accounts.listAccounts(t)).some((x) => x.id === a.id), false);
      await assert.rejects(
        tx.createTransaction(t, { date: '2026-11-08', type: 'transfer', accountId: b.id, toAccountId: a.id, amount: 1 }),
        (e) => e.status === 400, // アーカイブ済みの口座は指定できない
      );
    });
  });

  it('貯金：割当・解除・「この貯金で支払う」・取引削除（CASCADE）・アーカイブ', async () => {
    await inRolledBackTx(db, async (t) => {
      const { a, expenseId } = await seedMasters(t);
      const goal = await savings.createGoal(t, { name: '__test_goal__', targetAmount: 20000 });
      const allocated = async () => (await savings.getGoal(t, goal.id)).allocatedAmount;

      await savings.createAllocation(t, goal.id, { amount: 10000 });
      await savings.createAllocation(t, goal.id, { amount: -2000 });
      assert.equal(await allocated(), 8000);
      assert.equal((await savings.getGoal(t, goal.id)).progressRate, 0.4);

      // この貯金で支払う：出金が登録され、割当が同額減る。口座残高も減る
      const spent = await savings.spendFromGoal(t, goal.id, { date: '2026-11-08', accountId: a.id, categoryId: expenseId, amount: 3000 });
      assert.equal(spent.transaction.savingsGoalId, goal.id);
      assert.equal(await allocated(), 5000);
      assert.equal(await balanceOf(t, a.id), 7000);

      // 割当額を超える支払いは 409
      await assert.rejects(
        savings.spendFromGoal(t, goal.id, { date: '2026-11-08', accountId: a.id, categoryId: expenseId, amount: 5001 }),
        (e) => e.status === 409,
      );

      // 総資産と使えるお金（= 総資産 − 割当合計）
      const s = await getSummary(t);
      assert.ok(Number.isInteger(s.totalAssets) && s.available === s.totalAssets - s.savingsAllocated);

      // 取引を削除すると、紐づく割当解除も CASCADE で消え、割当額が元に戻る
      await tx.deleteTransaction(t, spent.transaction.id);
      assert.equal(await allocated(), 8000);
      assert.equal(await balanceOf(t, a.id), 10000);

      // アーカイブ：残り 8000 円が自動解除される
      await savings.archiveGoal(t, goal.id);
      const archived = await savings.getGoal(t, goal.id);
      assert.equal(archived.isArchived, true);
      assert.equal(archived.allocatedAmount, 0);
    });
  });

  it('月次レポート：振替を含めず、収入・支出をカテゴリ別に集計する', async () => {
    await inRolledBackTx(db, async (t) => {
      const { a, b, incomeId, expenseId } = await seedMasters(t);
      const date = '2031-05-10'; // 既存データと重ならない月
      await tx.createTransaction(t, { date, type: 'income', accountId: a.id, categoryId: incomeId, amount: 7000 });
      await tx.createTransaction(t, { date, type: 'expense', accountId: a.id, categoryId: expenseId, amount: 1500 });
      await tx.createTransaction(t, { date, type: 'expense', accountId: a.id, categoryId: expenseId, amount: 500 });
      await tx.createTransaction(t, { date, type: 'transfer', accountId: a.id, toAccountId: b.id, amount: 4000 });
      const r = await reports.monthlyReport(t, '2031-05');
      assert.equal(r.income, 7000);
      assert.equal(r.expense, 2000);
      assert.equal(r.net, 5000);
      assert.equal(r.expenseByCategory[0].amount, 2000);
      const y = await reports.yearlyReport(t, '2031');
      assert.deepEqual(y.months[4], { month: '2031-05', income: 7000, expense: 2000, net: 5000 });
    });
  });
});
