import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoBackend } from '../src/lib/demoBackend.js';
import { createApi } from '../src/lib/api.js';

// 2026-11-15 に固定。今月は 11/1〜11/15、先月は 10 月のデータが入る。
const NOW = new Date(2026, 10, 15, 12, 0, 0);
const setup = () => {
  const backend = createDemoBackend({ now: () => NOW });
  return { api: createApi({ fetchImpl: backend.fetch }), backend };
};
const status = (promise) => promise.then(() => 200, (e) => e.status);
const base = { date: '2026-11-15', amount: 1000, accountId: 1 };

describe('デモ：初期データとサマリー', () => {
  it('総資産 = 全口座残高の合計、使えるお金 = 総資産 − 貯金割当合計', async () => {
    const { api } = setup();
    const s = await api.get('/api/summary');
    // 銀行 320,000 + 280,000 − 85,000 − 30,000 = 485,000 / 現金 18,000 + 30,000 − 1,200 − 2,300 = 44,500
    // PayPay 5,000 − 580 = 4,420 / 楽天カード −12,800 − 1,490 = −14,290
    assert.deepEqual(s.accounts.map((a) => [a.name, a.balance]), [
      ['三菱UFJ銀行', 485000], ['現金', 44500], ['PayPay', 4420], ['楽天カード', -14290],
    ]);
    assert.equal(s.totalAssets, 485000 + 44500 + 4420 - 14290);
    assert.equal(s.savingsAllocated, 130000);
    assert.equal(s.available, s.totalAssets - 130000);
    assert.equal(s.isOverAllocated, false);
  });

  it('カテゴリは 17 件、出金が先・入金が後で、「その他」は最後', async () => {
    const { api } = setup();
    const list = await api.get('/api/categories');
    assert.equal(list.length, 17);
    assert.equal(list[0].type, 'expense');
    assert.equal(list[12].name, 'その他');
    assert.equal(list[13].type, 'income');
  });
});

describe('デモ：取引と残高', () => {
  it('入金・出金・振替が口座残高に反映される。編集・削除でも戻る', async () => {
    const { api } = setup();
    const balance = async (id) => (await api.get('/api/accounts')).find((a) => a.id === id).balance;
    assert.equal(await balance(1), 485000);

    const income = await api.post('/api/transactions', { ...base, type: 'income', categoryId: 14, amount: 5000 });
    assert.equal(await balance(1), 490000);
    const tr = await api.post('/api/transactions', { ...base, type: 'transfer', toAccountId: 2, amount: 3000 });
    assert.equal(await balance(1), 487000);
    assert.equal(await balance(2), 47500);
    assert.equal(tr.toAccountName, '現金');

    await api.put(`/api/transactions/${income.id}`, { ...base, type: 'income', categoryId: 14, amount: 6000 });
    assert.equal(await balance(1), 488000);
    await api.del(`/api/transactions/${tr.id}`);
    assert.equal(await balance(1), 491000);
    assert.equal(await balance(2), 44500);
  });

  it('月別一覧は新しい順。月の指定が不正なら 400', async () => {
    const { api } = setup();
    const list = await api.get('/api/transactions', { month: '2026-11' });
    assert.equal(list.length, 4);
    assert.ok(list.every((t) => t.date.startsWith('2026-11')));
    assert.ok(list[0].date >= list[list.length - 1].date);
    assert.equal(await status(api.get('/api/transactions', { month: '2026-13' })), 400);
    assert.equal(await status(api.get('/api/transactions')), 400);
  });

  it('入力の誤りは 400：カテゴリ種別の不一致、振替の不備、金額の範囲', async () => {
    const { api } = setup();
    assert.equal(await status(api.post('/api/transactions', { ...base, type: 'expense', categoryId: 14 })), 400); // 出金に入金カテゴリ
    assert.equal(await status(api.post('/api/transactions', { ...base, type: 'transfer', toAccountId: 1 })), 400);
    assert.equal(await status(api.post('/api/transactions', { ...base, type: 'transfer', toAccountId: 2, categoryId: 1 })), 400);
    assert.equal(await status(api.post('/api/transactions', { ...base, type: 'expense', categoryId: 1, amount: 0 })), 400);
    assert.equal(await status(api.post('/api/transactions', { ...base, type: 'expense', categoryId: 1, date: '2026-02-30' })), 400);
    assert.equal(await status(api.post('/api/transactions', { ...base, type: 'expense', categoryId: 1, accountId: 99 })), 400);
  });
});

describe('デモ：口座・カテゴリ', () => {
  it('残高のある口座はアーカイブできず（409）、0 にすればできる。アーカイブ済みは指定できない', async () => {
    const { api } = setup();
    assert.equal(await status(api.del('/api/accounts/3')), 409);
    await api.post('/api/transactions', { ...base, type: 'transfer', accountId: 3, toAccountId: 2, amount: 4420 });
    await api.del('/api/accounts/3');
    assert.equal((await api.get('/api/accounts')).some((a) => a.id === 3), false);
    assert.equal(await status(api.post('/api/transactions', { ...base, type: 'expense', categoryId: 1, accountId: 3 })), 400);
    assert.equal(await status(api.del('/api/accounts/3')), 404);
  });

  it('マイナス残高（クレジットカード）もアーカイブ不可', async () => {
    const { api } = setup();
    assert.equal(await status(api.del('/api/accounts/4')), 409);
  });

  it('カテゴリ：同名は 409、削除済みと同名なら復活。新規は「その他」の前に並ぶ', async () => {
    const { api } = setup();
    assert.equal(await status(api.post('/api/categories', { type: 'expense', name: '食費' })), 409);
    const pet = await api.post('/api/categories', { type: 'expense', name: 'ペット' });
    assert.equal(pet.sortOrder, 130);
    await api.del(`/api/categories/${pet.id}`);
    const restored = await api.post('/api/categories', { type: 'expense', name: 'ペット' });
    assert.equal(restored.id, pet.id);
    assert.equal(restored.isArchived, false);
    assert.equal(await status(api.put('/api/categories/1', { type: 'income' })), 400);
    assert.equal((await api.put('/api/categories/1', { name: '食料品' })).name, '食料品');
  });

  it('削除したカテゴリでも、過去の取引はそのまま表示でき、編集も続けられる', async () => {
    const { api } = setup();
    const list = await api.get('/api/transactions', { month: '2026-11' });
    const lunch = list.find((t) => t.memo === 'ランチ');
    await api.del(`/api/categories/${lunch.categoryId}`);
    const edited = await api.put(`/api/transactions/${lunch.id}`, { type: 'expense', date: lunch.date, amount: lunch.amount, accountId: lunch.accountId, categoryId: lunch.categoryId, memo: '修正' });
    assert.equal(edited.categoryName, '食費');
    assert.equal(await status(api.post('/api/transactions', { ...base, type: 'expense', categoryId: lunch.categoryId })), 400);
  });
});

describe('デモ：貯金', () => {
  it('一覧は割当額と進捗率つき', async () => {
    const { api } = setup();
    const goals = await api.get('/api/savings');
    assert.deepEqual(goals.map((g) => [g.name, g.allocatedAmount, g.progressRate]), [['旅行', 30000, 0.3], ['緊急資金', 100000, 0.2]]);
  });

  it('割当・解除：解除は割当額まで（超えると 409）', async () => {
    const { api } = setup();
    await api.post('/api/savings/1/allocations', { amount: 5000, memo: '臨時' });
    assert.equal((await api.get('/api/savings')).find((g) => g.id === 1).allocatedAmount, 35000);
    assert.equal(await status(api.post('/api/savings/1/allocations', { amount: -35001 })), 409);
    await api.post('/api/savings/1/allocations', { amount: -35000 });
    assert.equal((await api.get('/api/savings')).find((g) => g.id === 1).allocatedAmount, 0);
    assert.equal(await status(api.post('/api/savings/1/allocations', { amount: 0 })), 400);
    const history = await api.get('/api/savings/1/allocations');
    assert.equal(history.length, 3);
  });

  it('この貯金で支払う：出金が登録され、同額の割当が減り、口座残高も減る', async () => {
    const { api } = setup();
    const result = await api.post('/api/savings/1/spend', { date: '2026-11-15', accountId: 1, categoryId: 11, amount: 8000, memo: '新幹線' });
    assert.equal(result.transaction.type, 'expense');
    assert.equal(result.transaction.savingsGoalId, 1);
    assert.equal(result.allocation.amount, -8000);
    assert.equal(result.allocation.transactionId, result.transaction.id);
    assert.equal(result.goal.allocatedAmount, 22000);
    assert.equal((await api.get('/api/accounts')).find((a) => a.id === 1).balance, 477000);
    // 総資産は 8,000 減り、割当合計も 8,000 減るので、使えるお金は変わらない
    const s = await api.get('/api/summary');
    assert.equal(s.savingsAllocated, 122000);
  });

  it('割当額が足りなければ 409 で、何も登録されない', async () => {
    const { api } = setup();
    assert.equal(await status(api.post('/api/savings/1/spend', { date: '2026-11-15', accountId: 1, categoryId: 11, amount: 30001 })), 409);
    assert.equal((await api.get('/api/transactions', { month: '2026-11' })).length, 4);
    // 割当額ちょうど（30,000 円）の支払いは成功する（境界値）
    const exact = await api.post('/api/savings/1/spend', { date: '2026-11-15', accountId: 1, categoryId: 11, amount: 30000 });
    assert.equal(exact.goal.allocatedAmount, 0);
  });

  it('貯金で支払った取引：金額・種別は変更不可（409）、削除すると割当解除も消えて割当額が戻る', async () => {
    const { api } = setup();
    const { transaction } = await api.post('/api/savings/1/spend', { date: '2026-11-15', accountId: 1, categoryId: 11, amount: 8000 });
    const body = { type: 'expense', date: '2026-11-16', amount: 8000, accountId: 1, categoryId: 11, memo: '日付だけ修正' };
    assert.equal((await api.put(`/api/transactions/${transaction.id}`, body)).date, '2026-11-16');
    assert.equal(await status(api.put(`/api/transactions/${transaction.id}`, { ...body, amount: 9000 })), 409);
    await api.del(`/api/transactions/${transaction.id}`);
    assert.equal((await api.get('/api/savings')).find((g) => g.id === 1).allocatedAmount, 30000);
  });

  it('アーカイブ：残りの割当額を自動解除して使えるお金に戻す。以後は割当・支払いできない', async () => {
    const { api, backend } = setup();
    const before = await api.get('/api/summary');
    await api.del('/api/savings/1');
    const after = await api.get('/api/summary');
    assert.equal(after.savingsAllocated, before.savingsAllocated - 30000);
    assert.equal(after.available, before.available + 30000);
    assert.equal((await api.get('/api/savings')).some((g) => g.id === 1), false);
    assert.equal(await status(api.post('/api/savings/1/allocations', { amount: 100 })), 409);
    assert.equal(backend.state.allocations.at(-1).memo, 'アーカイブに伴う自動解除');
    assert.equal(await status(api.del('/api/savings/1')), 404);
  });
});

describe('デモ：レポートと CSV', () => {
  it('月次：収入・支出・カテゴリ別（振替は含めない）', async () => {
    const { api } = setup();
    const oct = await api.get('/api/reports/monthly', { month: '2026-10' });
    assert.equal(oct.income, 280000);
    assert.equal(oct.expense, 97800); // 85,000 + 12,800（振替 30,000 は含めない）
    assert.equal(oct.net, 182200);
    assert.deepEqual(oct.expenseByCategory.map((c) => c.categoryName), ['住居費', '食費']);
    const nov = await api.get('/api/reports/monthly', { month: '2026-11' });
    assert.equal(nov.expense, 1200 + 580 + 1490 + 2300);
  });

  it('年次：12 か月分を返す', async () => {
    const { api } = setup();
    const y = await api.get('/api/reports/yearly', { year: '2026' });
    assert.equal(y.months.length, 12);
    assert.equal(y.months[9].income, 280000);
    assert.equal(y.months[0].income, 0);
    assert.equal(y.income, 280000);
  });

  it('CSV：BOM 付き・ヘッダー・日本語の種別。期間の逆転は 400', async () => {
    const { api } = setup();
    const { blob, filename } = await api.download('/api/export/transactions', { from: '2026-11-01', to: '2026-11-30' });
    assert.equal(filename, 'transactions_20261115.csv');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]); // UTF-8 BOM（Blob.text() は BOM を取り除くので直接調べる）
    const text = await blob.text();
    assert.ok(text.startsWith('ID,日付,種別,口座'));
    assert.equal(text.trim().split('\r\n').length, 5);
    assert.match(text, /出金/);
    assert.equal(await status(api.download('/api/export/transactions', { from: '2026-12-01', to: '2026-11-01' })), 400);
  });
});
