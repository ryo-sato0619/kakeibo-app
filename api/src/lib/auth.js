'use strict';

const { unauthorized, forbidden } = require('./errors');

/**
 * SWA が付与する x-ms-client-principal ヘッダー（Base64 の JSON）をデコードする。
 * 読み取れなければ null。
 */
function decodeClientPrincipal(header) {
  if (!header) return null;
  try {
    const parsed = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

/**
 * owner ロールを持つ要求だけを通す（多層防御）。
 * ヘッダーなし／読み取り不可 → 401、owner ロールなし → 403。
 */
function requireOwner(request) {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) throw unauthorized();
  const principal = decodeClientPrincipal(header);
  if (!principal) throw unauthorized('認証情報を読み取れません');
  const roles = Array.isArray(principal.userRoles) ? principal.userRoles : [];
  if (!roles.includes('owner')) throw forbidden();
  return principal;
}

module.exports = { decodeClientPrincipal, requireOwner };
