'use strict';

const { listAccounts } = require('./accounts');

/**
 * 総資産 = 全口座残高の合計
 * 貯金割当合計 = savings_allocations の合計
 * 使えるお金 = 総資産 − 貯金割当合計（マイナスのとき isOverAllocated = true）
 */
async function getSummary(db) {
  const rows = await db.query(
    `SELECT
       (SELECT COALESCE(SUM(balance), 0) FROM v_account_balances) AS totalAssets,
       (SELECT COALESCE(SUM(amount), 0) FROM savings_allocations) AS savingsAllocated`,
  );
  const { totalAssets, savingsAllocated } = rows[0];
  const available = totalAssets - savingsAllocated;
  const accounts = await listAccounts(db);
  return { totalAssets, savingsAllocated, available, isOverAllocated: available < 0, accounts };
}

module.exports = { getSummary };
