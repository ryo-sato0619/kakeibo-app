// 画面側の入力チェック（サーバー側でも同じ規則で再検証される）
import { isValidDate } from './format.js';

export const MAX_AMOUNT = 99999999;

/** 全角数字・全角カンマ・全角マイナスを半角にそろえる（日本語入力対策） */
export function normalizeDigits(text) {
  return String(text ?? '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，、]/g, ',')
    .replace(/[－−ー]/g, '-');
}

/** 金額の入力文字列 → 整数。カンマ・空白・¥・円は無視。不正なら null。 */
export function parseAmountInput(text, { allowNegative = false } = {}) {
  const s = normalizeDigits(text).replace(/[,\s¥円]/g, '');
  const pattern = allowNegative ? /^-?\d+$/ : /^\d+$/;
  if (!pattern.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

export function validateAmount(text, { allowNegative = false } = {}) {
  const n = parseAmountInput(text, { allowNegative });
  if (n === null) return '金額を整数で入力してください';
  if (allowNegative ? Math.abs(n) > MAX_AMOUNT : n < 1 || n > MAX_AMOUNT) {
    return allowNegative
      ? '金額は絶対値 99,999,999 以下の整数で入力してください'
      : '金額は 1〜99,999,999 の整数で入力してください';
  }
  return null;
}

export function validateName(text, label = '名称') {
  const s = String(text ?? '').trim();
  if (s.length < 1) return `${label}を入力してください`;
  if (s.length > 50) return `${label}は 50 文字以内で入力してください`;
  return null;
}

export function validateMemo(text) {
  return String(text ?? '').trim().length > 200 ? 'メモは 200 文字以内で入力してください' : null;
}

/** 取引フォームの検証。{ 項目名: メッセージ } を返す（空なら OK） */
export function validateTransactionForm(v) {
  const errors = {};
  if (!['income', 'expense', 'transfer'].includes(v.type)) errors.type = '種別を選んでください';
  if (!isValidDate(v.date)) errors.date = '日付を正しく入力してください';
  const amountError = validateAmount(v.amount);
  if (amountError) errors.amount = amountError;
  if (!v.accountId) errors.accountId = v.type === 'transfer' ? '振替元の口座を選んでください' : '口座を選んでください';
  if (v.type === 'transfer') {
    if (!v.toAccountId) errors.toAccountId = '振替先の口座を選んでください';
    else if (String(v.toAccountId) === String(v.accountId)) errors.toAccountId = '振替元とは別の口座を選んでください';
  } else if (!v.categoryId) {
    errors.categoryId = 'カテゴリを選んでください';
  }
  const memoError = validateMemo(v.memo);
  if (memoError) errors.memo = memoError;
  return errors;
}

/** フォームの値 → API に送る JSON（検証済みの値が前提） */
export function buildTransactionPayload(v) {
  const payload = {
    type: v.type,
    date: v.date,
    amount: parseAmountInput(v.amount),
    accountId: Number(v.accountId),
    memo: String(v.memo ?? '').trim() || null,
  };
  if (v.type === 'transfer') payload.toAccountId = Number(v.toAccountId);
  else payload.categoryId = Number(v.categoryId);
  return payload;
}
