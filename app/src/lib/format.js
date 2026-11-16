// 金額・日付の整形（ブラウザの地域設定に依存しない実装）

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export const pad2 = (n) => String(n).padStart(2, '0');

/** 3 桁区切り（符号なし）。例: 1234567 → "1,234,567" */
export function withCommas(n) {
  return String(Math.trunc(Math.abs(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** ¥12,345 / -¥12,345 */
export function formatYen(n) {
  const v = Number(n) || 0;
  return `${v < 0 ? '-' : ''}¥${withCommas(v)}`;
}

/** +¥12,345 / -¥12,345（0 は ¥0） */
export function formatSignedYen(n) {
  const v = Number(n) || 0;
  if (v === 0) return '¥0';
  return `${v < 0 ? '-' : '+'}¥${withCommas(v)}`;
}

/** Date → 'YYYY-MM-DD'（その端末のローカル日付） */
export function toDateString(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Date → 'YYYY-MM' */
export function currentMonth(d = new Date()) {
  return toDateString(d).slice(0, 7);
}

/** 'YYYY-MM' に月数を足し引きする */
export function addMonths(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const mon = ((index % 12) + 12) % 12;
  return `${year}-${pad2(mon + 1)}`;
}

/** '2026-11' → '2026年11月' */
export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月`;
}

/** '2026-11-08' → '11月8日（日）' */
export function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}月${d}日（${WEEKDAYS[weekday]}）`;
}

/** 実在する YYYY-MM-DD か */
export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 進捗率（0.5 → "50%"）。null は "—" */
export function percentLabel(rate) {
  if (rate === null || rate === undefined) return '—';
  return `${Math.round(rate * 100)}%`;
}

/** 全体に占める割合（%、小数 1 桁） */
export function sharePercent(part, total) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}
