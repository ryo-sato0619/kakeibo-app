'use strict';

const { badRequest } = require('./errors');
const { isValidDateString, monthRange } = require('./dates');

const MAX_AMOUNT = 99999999;
const MAX_ID = 2147483647;
const MAX_SORT_ORDER = 999999;

const withCommas = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const isPresent = (value) => value !== undefined && value !== null;

function requireObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('リクエストボディは JSON オブジェクトで指定してください');
  }
  return body;
}

/** パスパラメータや ID フィールド。正の整数（数値または数字文字列）を受け付ける。 */
function parseId(value, field = 'id') {
  const ok =
    typeof value === 'number' ? Number.isInteger(value) : typeof value === 'string' && /^\d{1,10}$/.test(value);
  if (ok) {
    const n = Number(value);
    if (n >= 1 && n <= MAX_ID) return n;
  }
  throw badRequest(`${field} は正の整数で指定してください`);
}

/** 金額：1 〜 99,999,999 の整数 */
function parseAmount(value, field = 'amount') {
  if (!Number.isInteger(value) || value < 1 || value > MAX_AMOUNT) {
    throw badRequest(`${field} は 1 〜 ${withCommas(MAX_AMOUNT)} の整数で指定してください`);
  }
  return value;
}

/** 割当・解除の金額：0 以外の整数（正：割当 / 負：解除） */
function parseSignedAmount(value, field = 'amount') {
  if (!Number.isInteger(value) || value === 0 || Math.abs(value) > MAX_AMOUNT) {
    throw badRequest(`${field} は 0 以外の整数（絶対値 ${withCommas(MAX_AMOUNT)} 以下）で指定してください`);
  }
  return value;
}

/** 口座の初期残高：クレジットカード等のマイナスも許可 */
function parseOpeningBalance(value, field = 'openingBalance') {
  if (!Number.isInteger(value) || Math.abs(value) > MAX_AMOUNT) {
    throw badRequest(`${field} は整数（絶対値 ${withCommas(MAX_AMOUNT)} 以下）で指定してください`);
  }
  return value;
}

/** 貯金の目標金額：0 〜 99,999,999（0 は目標未設定） */
function parseTargetAmount(value, field = 'targetAmount') {
  if (!Number.isInteger(value) || value < 0 || value > MAX_AMOUNT) {
    throw badRequest(`${field} は 0 〜 ${withCommas(MAX_AMOUNT)} の整数で指定してください`);
  }
  return value;
}

function parseSortOrder(value, field = 'sortOrder') {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SORT_ORDER) {
    throw badRequest(`${field} は 0 〜 ${MAX_SORT_ORDER} の整数で指定してください`);
  }
  return value;
}

/** 名称：前後の空白を除いて 1 〜 50 文字 */
function parseName(value, field = 'name') {
  if (typeof value !== 'string') throw badRequest(`${field} は文字列で指定してください`);
  const s = value.trim();
  if (s.length < 1 || s.length > 50) throw badRequest(`${field} は 1 〜 50 文字で指定してください`);
  return s;
}

/** メモ：省略・null・空文字は null。200 文字以内。 */
function parseMemo(value, field = 'memo') {
  if (!isPresent(value)) return null;
  if (typeof value !== 'string') throw badRequest(`${field} は文字列で指定してください`);
  const s = value.trim();
  if (s === '') return null;
  if (s.length > 200) throw badRequest(`${field} は 200 文字以内で指定してください`);
  return s;
}

function parseEnum(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw badRequest(`${field} は ${allowed.join(' / ')} のいずれかで指定してください`);
  }
  return value;
}

/** 日付：YYYY-MM-DD（実在する日付のみ） */
function parseDate(value, field = 'date') {
  if (!isValidDateString(value)) throw badRequest(`${field} は YYYY-MM-DD 形式の正しい日付で指定してください`);
  return value;
}

/** 月：YYYY-MM → { month, start, end } */
function parseMonth(value, field = 'month') {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw badRequest(`${field} は YYYY-MM 形式で指定してください`);
  }
  return monthRange(value);
}

/** 年：YYYY（1900 〜 2999） */
function parseYear(value, field = 'year') {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) throw badRequest(`${field} は YYYY 形式で指定してください`);
  const y = Number(value);
  if (y < 1900 || y > 2999) throw badRequest(`${field} は 1900 〜 2999 の範囲で指定してください`);
  return y;
}

module.exports = {
  MAX_AMOUNT,
  isPresent,
  requireObject,
  parseId,
  parseAmount,
  parseSignedAmount,
  parseOpeningBalance,
  parseTargetAmount,
  parseSortOrder,
  parseName,
  parseMemo,
  parseEnum,
  parseDate,
  parseMonth,
  parseYear,
};
