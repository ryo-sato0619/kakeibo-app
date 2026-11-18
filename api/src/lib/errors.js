'use strict';

/** API が返すエラー。status / code / message がそのままレスポンスになる。 */
class ApiError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail; // 診断用の短いコード（例: 40613 / ESOCKET/ENOTFOUND）。メッセージや接続情報は含めない
  }
}

const badRequest = (message) => new ApiError(400, 'VALIDATION_ERROR', message);
const unauthorized = (message = 'ログインが必要です') => new ApiError(401, 'UNAUTHORIZED', message);
const forbidden = (message = 'この操作を行う権限がありません') => new ApiError(403, 'FORBIDDEN', message);
const notFound = (message = '対象が見つかりません') => new ApiError(404, 'NOT_FOUND', message);
const conflict = (message) => new ApiError(409, 'CONFLICT', message);
const dbUnavailable = (message = 'データベースを起動中です。しばらくしてからもう一度お試しください。', detail) =>
  new ApiError(503, 'DB_UNAVAILABLE', message, detail);

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict, dbUnavailable };
