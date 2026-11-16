'use strict';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** YYYY-MM-DD が実在する日付かどうか（2026-02-30 などは false） */
function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 'YYYY-MM' → { month, start: 'YYYY-MM-01', end: 翌月1日 }（end は含まない） */
function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const pad = (n) => String(n).padStart(2, '0');
  return { month, start: `${y}-${pad(m)}-01`, end: `${ny}-${pad(nm)}-01` };
}

/** 今日の日付（JST）を YYYY-MM-DD で返す。now はテスト用に差し替え可能。 */
function todayJst(now = Date.now()) {
  return new Date(now + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** DB の UTC 日時を JST の 'YYYY-MM-DD HH:mm:ss' にする。値が無ければ空文字。 */
function formatJstDateTime(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = { isValidDateString, monthRange, todayJst, formatJstDateTime };
