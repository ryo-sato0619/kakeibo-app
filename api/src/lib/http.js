'use strict';

const { ApiError, badRequest } = require('./errors');
const { requireOwner } = require('./auth');
const { getDb, isTransient } = require('./db');

const ok = (data) => ({ status: 200, jsonBody: data });
const created = (data) => ({ status: 201, jsonBody: data });
const noContent = () => ({ status: 204 });

/** CSV を UTF-8 BOM 付きで返す（Excel で文字化けしない） */
function csvResponse(text, filename) {
  return {
    status: 200,
    body: `\uFEFF${text}`,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (_) {
    throw badRequest('リクエストボディを JSON として読み取れません');
  }
}

function errorBody(code, message) {
  return { error: { code, message } };
}

/** 例外 → HTTP レスポンス。想定外の内容（SQL のエラー文など）は画面に返さずログにだけ残す。 */
function toErrorResponse(err, context) {
  if (err instanceof ApiError) {
    return { status: err.status, jsonBody: errorBody(err.code, err.message) };
  }
  if (isTransient(err)) {
    return {
      status: 503,
      jsonBody: errorBody('DB_UNAVAILABLE', 'データベースを起動中です。しばらくしてからもう一度お試しください。'),
    };
  }
  const number = err && (err.number || (err.originalError && err.originalError.number));
  if (number === 2627 || number === 2601) {
    return { status: 409, jsonBody: errorBody('CONFLICT', '既に同じデータが存在します') };
  }
  if (number === 547) {
    return { status: 409, jsonBody: errorBody('CONFLICT', '関連するデータがあるため、この操作は行えません') };
  }
  if (context && typeof context.error === 'function') context.error(err);
  return { status: 500, jsonBody: errorBody('INTERNAL_ERROR', '内部エラーが発生しました') };
}

/**
 * HTTP トリガー用のラッパー。
 *   route(fn)                      … メソッドを問わず fn を呼ぶ
 *   route({ GET: fn, POST: fn })   … メソッドごとに振り分ける（それ以外は 405）
 * 先に owner ロールを検証し（401 / 403）、例外を共通のエラー形式に変換する。
 * fn には { request, principal, params, query, db, readJson } を渡す。
 */
function route(handlers, deps = {}) {
  const resolveDb = deps.getDb || getDb;
  return async (request, context) => {
    try {
      const principal = requireOwner(request);
      const method = String(request.method || 'GET').toUpperCase();
      const handler = typeof handlers === 'function' ? handlers : handlers[method];
      if (!handler) {
        return {
          status: 405,
          jsonBody: errorBody('METHOD_NOT_ALLOWED', `${method} は使用できません`),
          headers: { 'cache-control': 'no-store' },
        };
      }
      const result = await handler({
        request,
        principal,
        params: request.params || {},
        query: request.query || new URLSearchParams(),
        db: resolveDb(),
        readJson: () => readJson(request),
      });
      return { ...result, headers: { 'cache-control': 'no-store', ...(result.headers || {}) } };
    } catch (err) {
      return { ...toErrorResponse(err, context), headers: { 'cache-control': 'no-store' } };
    }
  };
}

module.exports = { route, ok, created, noContent, csvResponse, toErrorResponse };
