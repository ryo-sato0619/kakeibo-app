'use strict';

/** API が返すエラー。status / code / message がそのままレスポンスになる。 */
class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const badRequest = (message) => new ApiError(400, 'VALIDATION_ERROR', message);
const unauthorized = (message = 'ログインが必要です') => new ApiError(401, 'UNAUTHORIZED', message);
const forbidden = (message = 'この操作を行う権限がありません') => new ApiError(403, 'FORBIDDEN', message);
const notFound = (message = '対象が見つかりません') => new ApiError(404, 'NOT_FOUND', message);
const conflict = (message) => new ApiError(409, 'CONFLICT', message);
const dbUnavailable = (message = 'データベースを起動中です。しばらくしてからもう一度お試しください。') =>
  new ApiError(503, 'DB_UNAVAILABLE', message);

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict, dbUnavailable };
