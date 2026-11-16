// デモモード用の仮バックエンド（メモリ上）。本物の API と同じ URL・JSON・エラー規則で応答する。
// データは保存されず、ページを再読み込みすると元に戻る。
import { addMonths, currentMonth, isValidDate, toDateString, pad2 } from './format.js';

const ACCOUNT_KINDS = ['bank', 'cash', 'emoney', 'credit'];
const MAX_AMOUNT = 99999999;

class Fail extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = (m) => new Fail(400, 'VALIDATION_ERROR', m);
const notFound = (m = '対象が見つかりません') => new Fail(404, 'NOT_FOUND', m);
const conflict = (m) => new Fail(409, 'CONFLICT', m);

// ---- 入力チェック（API と同じ規則）----
const isObj = (b) => b !== null && typeof b === 'object' && !Array.isArray(b);
const obj = (b) => {
  if (!isObj(b)) throw bad('リクエストボディは JSON オブジェクトで指定してください');
  return b;
};
const nameOf = (v, f = 'name') => {
  if (typeof v !== 'string' || v.trim().length < 1 || v.trim().length > 50) throw bad(`${f} は 1 〜 50 文字で指定してください`);
  return v.trim();
};
const memoOf = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw bad('memo は文字列で指定してください');
  const s = v.trim();
  if (!s) return null;
  if (s.length > 200) throw bad('memo は 200 文字以内で指定してください');
  return s;
};
const amountOf = (v, f = 'amount') => {
  if (!Number.isInteger(v) || v < 1 || v > MAX_AMOUNT) throw bad(`${f} は 1 〜 99,999,999 の整数で指定してください`);
  return v;
};
const signedOf = (v, f = 'amount') => {
  if (!Number.isInteger(v) || v === 0 || Math.abs(v) > MAX_AMOUNT) throw bad(`${f} は 0 以外の整数で指定してください`);
  return v;
};
const openingOf = (v) => {
  if (!Number.isInteger(v) || Math.abs(v) > MAX_AMOUNT) throw bad('openingBalance は整数で指定してください');
  return v;
};
const targetOf = (v) => {
  if (!Number.isInteger(v) || v < 0 || v > MAX_AMOUNT) throw bad('targetAmount は 0 〜 99,999,999 の整数で指定してください');
  return v;
};
const sortOf = (v) => {
  if (!Number.isInteger(v) || v < 0 || v > 999999) throw bad('sortOrder は 0 〜 999999 の整数で指定してください');
  return v;
};
const enumOf = (v, list, f) => {
  if (!list.includes(v)) throw bad(`${f} は ${list.join(' / ')} のいずれかで指定してください`);
  return v;
};
const dateOf = (v, f = 'date') => {
  if (!isValidDate(v)) throw bad(`${f} は YYYY-MM-DD 形式の正しい日付で指定してください`);
  return v;
};
const idOf = (v, f) => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (!Number.isInteger(n) || n < 1) throw bad(`${f} は正の整数で指定してください`);
  return n;
};
const monthOf = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw bad('month は YYYY-MM 形式で指定してください');
  return v;
};

const bySort = (a, b) => a.sortOrder - b.sortOrder || a.id - b.id;
const nextSort = (list) => Math.max(0, ...list.map((x) => x.sortOrder)) + 10;

// ---- 初期データ ----
function seedState(now) {
  const month = currentMonth(now);
  const prev = addMonths(month, -1);
  const todayDay = now.getDate();
  const day = (m, d) => `${m}-${pad2(m === month ? Math.min(d, todayDay) : d)}`;

  const state = {
    accounts: [
      { id: 1, name: '三菱UFJ銀行', kind: 'bank', openingBalance: 320000, sortOrder: 10, isArchived: false },
      { id: 2, name: '現金', kind: 'cash', openingBalance: 18000, sortOrder: 20, isArchived: false },
      { id: 3, name: 'PayPay', kind: 'emoney', openingBalance: 5000, sortOrder: 30, isArchived: false },
      { id: 4, name: '楽天カード', kind: 'credit', openingBalance: 0, sortOrder: 40, isArchived: false },
    ],
    categories: [],
    transactions: [],
    goals: [
      { id: 1, name: '旅行', targetAmount: 100000, sortOrder: 10, isArchived: false },
      { id: 2, name: '緊急資金', targetAmount: 500000, sortOrder: 20, isArchived: false },
    ],
    allocations: [],
    ids: { account: 5, category: 1, tx: 1, goal: 3, alloc: 1 },
  };

  const expenseNames = ['食費', '日用品', '交通費', '住居費', '水道光熱費', '通信費', 'サブスク', '医療費', '衣服・美容', '交際費', '趣味・娯楽', '教育・書籍'];
  expenseNames.forEach((name, i) =>
    state.categories.push({ id: state.ids.category++, type: 'expense', name, sortOrder: (i + 1) * 10, isArchived: false }),
  );
  state.categories.push({ id: state.ids.category++, type: 'expense', name: 'その他', sortOrder: 999, isArchived: false });
  ['給与', '賞与', '副収入'].forEach((name, i) =>
    state.categories.push({ id: state.ids.category++, type: 'income', name, sortOrder: (i + 1) * 10, isArchived: false }),
  );
  state.categories.push({ id: state.ids.category++, type: 'income', name: 'その他', sortOrder: 999, isArchived: false });

  const cat = (type, name) => state.categories.find((c) => c.type === type && c.name === name).id;
  const tx = (date, type, accountId, categoryId, amount, memo = null, toAccountId = null) =>
    state.transactions.push({ id: state.ids.tx++, date, type, accountId, toAccountId, categoryId, amount, memo });

  tx(day(prev, 25), 'income', 1, cat('income', '給与'), 280000, '給与');
  tx(day(prev, 27), 'expense', 1, cat('expense', '住居費'), 85000, '家賃');
  tx(day(prev, 15), 'expense', 4, cat('expense', '食費'), 12800, 'スーパー');
  tx(day(prev, 20), 'transfer', 1, null, 30000, '現金を引き出し', 2);
  tx(day(month, 1), 'expense', 2, cat('expense', '食費'), 1200, 'ランチ');
  tx(day(month, 2), 'expense', 3, cat('expense', '交通費'), 580, '電車');
  tx(day(month, 3), 'expense', 4, cat('expense', 'サブスク'), 1490, '動画配信');
  tx(day(month, 5), 'expense', 2, cat('expense', '日用品'), 2300, 'ドラッグストア');

  state.allocations.push({ id: state.ids.alloc++, goalId: 1, date: day(prev, 25), amount: 30000, transactionId: null, memo: '給料日に割当' });
  state.allocations.push({ id: state.ids.alloc++, goalId: 2, date: day(prev, 25), amount: 100000, transactionId: null, memo: null });
  return state;
}

const csvCell = (value, text = false) => {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function createDemoBackend({ now = () => new Date(), latencyMs = 0 } = {}) {
  const state = seedState(now());
  const ids = state.ids;
  const today = () => toDateString(now());

  // ---- 計算 ----
  const balanceOf = (a) =>
    a.openingBalance +
    state.transactions.reduce((sum, t) => {
      if (t.type === 'income' && t.accountId === a.id) return sum + t.amount;
      if (t.type === 'expense' && t.accountId === a.id) return sum - t.amount;
      if (t.type === 'transfer' && t.accountId === a.id) return sum - t.amount;
      if (t.type === 'transfer' && t.toAccountId === a.id) return sum + t.amount;
      return sum;
    }, 0);
  const accountView = (a) => ({ ...a, balance: balanceOf(a) });
  const allocatedOf = (goalId) => state.allocations.filter((x) => x.goalId === goalId).reduce((s, x) => s + x.amount, 0);
  const goalView = (g) => {
    const allocatedAmount = allocatedOf(g.id);
    return { ...g, allocatedAmount, progressRate: g.targetAmount > 0 ? Math.round((allocatedAmount / g.targetAmount) * 10000) / 10000 : null };
  };
  const txView = (t) => {
    const a = state.accounts.find((x) => x.id === t.accountId);
    const ta = t.toAccountId ? state.accounts.find((x) => x.id === t.toAccountId) : null;
    const c = t.categoryId ? state.categories.find((x) => x.id === t.categoryId) : null;
    const link = state.allocations.find((x) => x.transactionId === t.id);
    return {
      id: t.id, date: t.date, type: t.type,
      accountId: t.accountId, accountName: a.name,
      toAccountId: t.toAccountId, toAccountName: ta ? ta.name : null,
      categoryId: t.categoryId, categoryName: c ? c.name : null,
      amount: t.amount, memo: t.memo, createdAt: null, updatedAt: null,
      savingsGoalId: link ? link.goalId : null,
    };
  };
  const allocView = (x) => ({ ...x, createdAt: null });
  const findAccount = (id) => state.accounts.find((a) => a.id === id) || null;
  const findGoal = (id) => state.goals.find((g) => g.id === id) || null;

  // ---- 取引の検証（API の parseTransactionBody + assertReferences と同じ）----
  function parseTx(body, existing) {
    const o = obj(body);
    const type = enumOf(o.type, ['income', 'expense', 'transfer'], 'type');
    const date = dateOf(o.date);
    const amount = amountOf(o.amount);
    const memo = memoOf(o.memo);
    const accountId = idOf(o.accountId, 'accountId');
    let toAccountId = null;
    let categoryId = null;
    if (type === 'transfer') {
      toAccountId = idOf(o.toAccountId, 'toAccountId');
      if (o.categoryId !== undefined && o.categoryId !== null) throw bad('振替にカテゴリは指定できません');
      if (toAccountId === accountId) throw bad('振替元と振替先には別の口座を指定してください');
    } else {
      if (o.toAccountId !== undefined && o.toAccountId !== null) throw bad('振替先（toAccountId）は振替のときだけ指定できます');
      categoryId = idOf(o.categoryId, 'categoryId');
    }
    const usable = (id, field, unchanged) => {
      const a = findAccount(id);
      if (!a) throw bad(`${field}: 指定された口座が存在しません`);
      if (a.isArchived && id !== unchanged) throw bad(`${field}: アーカイブ済みの口座は指定できません`);
    };
    usable(accountId, 'accountId', existing ? existing.accountId : null);
    if (toAccountId !== null) usable(toAccountId, 'toAccountId', existing ? existing.toAccountId : null);
    if (categoryId !== null) {
      const c = state.categories.find((x) => x.id === categoryId);
      if (!c) throw bad('categoryId: 指定されたカテゴリが存在しません');
      if (c.type !== type) throw bad('カテゴリの種別と取引の種別が一致しません');
      if (c.isArchived && categoryId !== (existing ? existing.categoryId : null)) throw bad('categoryId: 削除済みのカテゴリは指定できません');
    }
    return { type, date, amount, memo, accountId, toAccountId, categoryId };
  }

  // ---- 応答ヘルパー ----
  const ok = (body) => ({ status: 200, body });
  const created = (body) => ({ status: 201, body });
  const noContent = () => ({ status: 204 });

  const routes = [];
  const on = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern}$`), fn });

  // サマリー
  on('GET', '/api/summary', () => {
    const totalAssets = state.accounts.reduce((s, a) => s + balanceOf(a), 0);
    const savingsAllocated = state.allocations.reduce((s, x) => s + x.amount, 0);
    const available = totalAssets - savingsAllocated;
    const accounts = state.accounts.filter((a) => !a.isArchived).sort(bySort).map(accountView);
    return ok({ totalAssets, savingsAllocated, available, isOverAllocated: available < 0, accounts });
  });

  // 口座
  on('GET', '/api/accounts', ({ query }) =>
    ok(state.accounts.filter((a) => query.get('includeArchived') === '1' || !a.isArchived).sort(bySort).map(accountView)),
  );
  on('POST', '/api/accounts', ({ body }) => {
    const o = obj(body);
    const a = {
      id: ids.account++,
      name: nameOf(o.name),
      kind: enumOf(o.kind, ACCOUNT_KINDS, 'kind'),
      openingBalance: o.openingBalance == null ? 0 : openingOf(o.openingBalance),
      sortOrder: o.sortOrder == null ? nextSort(state.accounts) : sortOf(o.sortOrder),
      isArchived: false,
    };
    state.accounts.push(a);
    return created(accountView(a));
  });
  on('PUT', '/api/accounts/(\\d+)', ({ params, body }) => {
    const o = obj(body);
    const a = findAccount(params[0]);
    if (!a) throw notFound('口座が見つかりません');
    if (a.isArchived) throw conflict('アーカイブ済みの口座は編集できません');
    const sets = {};
    if (o.name !== undefined) sets.name = nameOf(o.name);
    if (o.kind !== undefined) sets.kind = enumOf(o.kind, ACCOUNT_KINDS, 'kind');
    if (o.openingBalance !== undefined) sets.openingBalance = openingOf(o.openingBalance);
    if (o.sortOrder !== undefined) sets.sortOrder = sortOf(o.sortOrder);
    if (!Object.keys(sets).length) throw bad('更新する項目がありません');
    Object.assign(a, sets);
    return ok(accountView(a));
  });
  on('DELETE', '/api/accounts/(\\d+)', ({ params }) => {
    const a = findAccount(params[0]);
    if (!a || a.isArchived) throw notFound('口座が見つかりません');
    if (balanceOf(a) !== 0) throw conflict('残高が 0 の口座のみアーカイブできます。先に振替などで残高を 0 にしてください');
    a.isArchived = true;
    return noContent();
  });

  // カテゴリ
  on('GET', '/api/categories', ({ query }) => {
    const type = query.get('type');
    if (type) enumOf(type, ['income', 'expense'], 'type');
    const list = state.categories
      .filter((c) => (!type || c.type === type) && (query.get('includeArchived') === '1' || !c.isArchived))
      .sort((a, b) => (a.type === b.type ? bySort(a, b) : a.type < b.type ? -1 : 1));
    return ok(list);
  });
  on('POST', '/api/categories', ({ body }) => {
    const o = obj(body);
    const type = enumOf(o.type, ['income', 'expense'], 'type');
    const name = nameOf(o.name);
    const sortOrder =
      o.sortOrder == null ? nextSort(state.categories.filter((c) => c.type === type && c.sortOrder < 900)) : sortOf(o.sortOrder);
    const same = state.categories.find((c) => c.type === type && c.name === name);
    if (same) {
      if (!same.isArchived) throw conflict('同じ名前のカテゴリが既にあります');
      Object.assign(same, { isArchived: false, sortOrder });
      return created(same);
    }
    const c = { id: ids.category++, type, name, sortOrder, isArchived: false };
    state.categories.push(c);
    return created(c);
  });
  on('PUT', '/api/categories/(\\d+)', ({ params, body }) => {
    const o = obj(body);
    const c = state.categories.find((x) => x.id === params[0]);
    if (!c) throw notFound('カテゴリが見つかりません');
    if (c.isArchived) throw conflict('削除済みのカテゴリは編集できません');
    if (o.type !== undefined && o.type !== c.type) throw bad('カテゴリの種別は変更できません');
    const sets = {};
    if (o.name !== undefined) {
      sets.name = nameOf(o.name);
      if (state.categories.some((x) => x.id !== c.id && x.type === c.type && x.name === sets.name)) throw conflict('同じ名前のカテゴリが既にあります');
    }
    if (o.sortOrder !== undefined) sets.sortOrder = sortOf(o.sortOrder);
    if (!Object.keys(sets).length) throw bad('更新する項目がありません');
    Object.assign(c, sets);
    return ok(c);
  });
  on('DELETE', '/api/categories/(\\d+)', ({ params }) => {
    const c = state.categories.find((x) => x.id === params[0]);
    if (!c || c.isArchived) throw notFound('カテゴリが見つかりません');
    c.isArchived = true;
    return noContent();
  });

  // 取引
  on('GET', '/api/transactions', ({ query }) => {
    const month = monthOf(query.get('month'));
    return ok(
      state.transactions
        .filter((t) => t.date.startsWith(month))
        .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1))
        .map(txView),
    );
  });
  on('POST', '/api/transactions', ({ body }) => {
    const t = { id: ids.tx++, ...parseTx(body, null) };
    state.transactions.push(t);
    return created(txView(t));
  });
  on('PUT', '/api/transactions/(\\d+)', ({ params, body }) => {
    const t = state.transactions.find((x) => x.id === params[0]);
    if (!t) throw notFound('取引が見つかりません');
    const input = parseTx(body, t);
    const linked = state.allocations.some((x) => x.transactionId === t.id);
    if (linked && (input.type !== t.type || input.amount !== t.amount)) {
      throw conflict('貯金で支払った取引の金額・種別は変更できません。削除して登録し直してください');
    }
    Object.assign(t, input);
    return ok(txView(t));
  });
  on('DELETE', '/api/transactions/(\\d+)', ({ params }) => {
    const i = state.transactions.findIndex((x) => x.id === params[0]);
    if (i < 0) throw notFound('取引が見つかりません');
    const [t] = state.transactions.splice(i, 1);
    state.allocations = state.allocations.filter((x) => x.transactionId !== t.id); // ON DELETE CASCADE
    return noContent();
  });

  // 貯金
  on('GET', '/api/savings', ({ query }) =>
    ok(state.goals.filter((g) => query.get('includeArchived') === '1' || !g.isArchived).sort(bySort).map(goalView)),
  );
  on('POST', '/api/savings', ({ body }) => {
    const o = obj(body);
    const g = {
      id: ids.goal++,
      name: nameOf(o.name),
      targetAmount: o.targetAmount == null ? 0 : targetOf(o.targetAmount),
      sortOrder: o.sortOrder == null ? nextSort(state.goals) : sortOf(o.sortOrder),
      isArchived: false,
    };
    state.goals.push(g);
    return created(goalView(g));
  });
  on('PUT', '/api/savings/(\\d+)', ({ params, body }) => {
    const o = obj(body);
    const g = findGoal(params[0]);
    if (!g) throw notFound('貯金目的が見つかりません');
    if (g.isArchived) throw conflict('アーカイブ済みの貯金目的は編集できません');
    const sets = {};
    if (o.name !== undefined) sets.name = nameOf(o.name);
    if (o.targetAmount !== undefined) sets.targetAmount = targetOf(o.targetAmount);
    if (o.sortOrder !== undefined) sets.sortOrder = sortOf(o.sortOrder);
    if (!Object.keys(sets).length) throw bad('更新する項目がありません');
    Object.assign(g, sets);
    return ok(goalView(g));
  });
  on('DELETE', '/api/savings/(\\d+)', ({ params }) => {
    const g = findGoal(params[0]);
    if (!g || g.isArchived) throw notFound('貯金目的が見つかりません');
    const remaining = allocatedOf(g.id);
    if (remaining !== 0) {
      state.allocations.push({ id: ids.alloc++, goalId: g.id, date: today(), amount: -remaining, transactionId: null, memo: 'アーカイブに伴う自動解除' });
    }
    g.isArchived = true;
    return noContent();
  });
  on('GET', '/api/savings/(\\d+)/allocations', ({ params }) => {
    if (!findGoal(params[0])) throw notFound('貯金目的が見つかりません');
    return ok(
      state.allocations
        .filter((x) => x.goalId === params[0])
        .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1))
        .map(allocView),
    );
  });
  on('POST', '/api/savings/(\\d+)/allocations', ({ params, body }) => {
    const o = obj(body);
    const amount = signedOf(o.amount);
    const date = o.date == null ? today() : dateOf(o.date);
    const memo = memoOf(o.memo);
    const g = findGoal(params[0]);
    if (!g) throw notFound('貯金目的が見つかりません');
    if (g.isArchived) throw conflict('アーカイブ済みの貯金目的には割当・解除できません');
    const current = allocatedOf(g.id);
    if (amount < 0 && current + amount < 0) throw conflict(`解除額が現在の割当額（${current}円）を超えています`);
    const x = { id: ids.alloc++, goalId: g.id, date, amount, transactionId: null, memo };
    state.allocations.push(x);
    return created(allocView(x));
  });
  on('POST', '/api/savings/(\\d+)/spend', ({ params, body }) => {
    const input = parseTx({ ...obj(body), type: 'expense' }, null);
    const g = findGoal(params[0]);
    if (!g) throw notFound('貯金目的が見つかりません');
    if (g.isArchived) throw conflict('アーカイブ済みの貯金目的では支払えません');
    const current = allocatedOf(g.id);
    if (current < input.amount) throw conflict(`割当額（${current}円）が支払額より少ないため、この貯金では支払えません`);
    const t = { id: ids.tx++, ...input };
    state.transactions.push(t);
    const x = { id: ids.alloc++, goalId: g.id, date: input.date, amount: -input.amount, transactionId: t.id, memo: input.memo };
    state.allocations.push(x);
    return created({ transaction: txView(t), allocation: allocView(x), goal: goalView(g) });
  });

  // レポート
  const sumBy = (list) => list.reduce((s, x) => s + x.amount, 0);
  on('GET', '/api/reports/monthly', ({ query }) => {
    const month = monthOf(query.get('month'));
    const rows = state.transactions.filter((t) => t.date.startsWith(month) && t.type !== 'transfer');
    const group = (type) => {
      const map = new Map();
      for (const t of rows.filter((r) => r.type === type)) map.set(t.categoryId, (map.get(t.categoryId) || 0) + t.amount);
      return [...map.entries()]
        .map(([categoryId, amount]) => ({ categoryId, categoryName: state.categories.find((c) => c.id === categoryId).name, amount }))
        .sort((a, b) => b.amount - a.amount || a.categoryId - b.categoryId);
    };
    const incomeByCategory = group('income');
    const expenseByCategory = group('expense');
    const income = sumBy(incomeByCategory);
    const expense = sumBy(expenseByCategory);
    return ok({ month, income, expense, net: income - expense, incomeByCategory, expenseByCategory });
  });
  on('GET', '/api/reports/yearly', ({ query }) => {
    const year = query.get('year');
    if (!/^\d{4}$/.test(year || '')) throw bad('year は YYYY 形式で指定してください');
    const months = [];
    for (let m = 1; m <= 12; m += 1) {
      const key = `${year}-${pad2(m)}`;
      const rows = state.transactions.filter((t) => t.date.startsWith(key));
      const income = sumBy(rows.filter((t) => t.type === 'income'));
      const expense = sumBy(rows.filter((t) => t.type === 'expense'));
      months.push({ month: key, income, expense, net: income - expense });
    }
    const income = months.reduce((s, m) => s + m.income, 0);
    const expense = months.reduce((s, m) => s + m.expense, 0);
    return ok({ year: Number(year), income, expense, net: income - expense, months });
  });

  // CSV
  on('GET', '/api/export/transactions', ({ query }) => {
    const from = query.get('from') ? dateOf(query.get('from'), 'from') : null;
    const to = query.get('to') ? dateOf(query.get('to'), 'to') : null;
    if (from && to && from > to) throw bad('from は to 以前の日付を指定してください');
    const label = { income: '入金', expense: '出金', transfer: '振替' };
    const lines = ['ID,日付,種別,口座,振替先口座,カテゴリ,金額,メモ,登録日時(JST),更新日時(JST)'];
    state.transactions
      .filter((t) => (!from || t.date >= from) && (!to || t.date <= to))
      .sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1))
      .map(txView)
      .forEach((t) =>
        lines.push(
          [t.id, t.date, label[t.type], csvCell(t.accountName, true), csvCell(t.toAccountName, true), csvCell(t.categoryName, true), t.amount, csvCell(t.memo, true), '', ''].join(','),
        ),
      );
    return {
      status: 200,
      text: `\uFEFF${lines.join('\r\n')}\r\n`,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="transactions_${today().replace(/-/g, '')}.csv"`,
      },
    };
  });

  // ---- fetch 互換の入口 ----
  const toResponse = (r) => {
    if (r.text !== undefined) return new Response(r.text, { status: r.status, headers: r.headers });
    if (r.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  const errorResponse = (status, code, message) => toResponse({ status, body: { error: { code, message } } });

  async function fetchImpl(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const method = String(init.method || 'GET').toUpperCase();
    const u = new URL(url, 'http://demo.local');
    if (latencyMs) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    let body;
    if (init.body) {
      try {
        body = JSON.parse(init.body);
      } catch (_) {
        return errorResponse(400, 'VALIDATION_ERROR', 'リクエストボディを JSON として読み取れません');
      }
    }
    for (const route of routes) {
      if (route.method !== method) continue;
      const m = route.re.exec(u.pathname);
      if (!m) continue;
      try {
        return toResponse(route.fn({ params: m.slice(1).map(Number), query: u.searchParams, body }));
      } catch (err) {
        if (err instanceof Fail) return errorResponse(err.status, err.code, err.message);
        return errorResponse(500, 'INTERNAL_ERROR', '内部エラーが発生しました');
      }
    }
    return errorResponse(404, 'NOT_FOUND', '対象が見つかりません');
  }

  return { fetch: fetchImpl, state };
}
