// API クライアント。fetch を差し替えられるので、テスト・デモモードでも同じコードが動く。

export class ApiError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail; // サーバーが返す診断用の短いコード（例: 40613）
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// DB が一時停止から復帰中のとき、API は 503 を返す。復帰に時間がかかって SWA の 45 秒制限に
// 達したときは 504 になる（API の処理は続いているので、少し待てばつながる）。どちらも再試行の対象。
const WAKING_STATUSES = [503, 504];

function buildUrl(path, query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

async function toApiError(res) {
  let code = `HTTP_${res.status}`;
  let message = `サーバーでエラーが発生しました（${res.status}）`;
  let detail;
  try {
    const body = await res.json();
    if (body && body.error) {
      code = body.error.code || code;
      message = body.error.message || message;
      detail = body.error.detail;
    }
  } catch (_) {
    /* JSON でなければ既定のメッセージ */
  }
  return new ApiError(res.status, code, message, detail);
}

/**
 * retry: DB が一時停止から復帰中（503 / 504）のときの再試行。GET だけ自動で繰り返す
 *        （更新系は二重登録を避けるため、画面側でもう一度操作してもらう）。
 * onWaking(true/false): 再試行中かどうかを画面に伝える。
 */
export function createApi({ fetchImpl, sleep = defaultSleep, retry = { max: 8, delayMs: 3000 }, onWaking = () => {} } = {}) {
  const doFetch = (...args) => (fetchImpl || globalThis.fetch)(...args);

  async function send(method, path, { body, query } = {}) {
    const url = buildUrl(path, query);
    const init = { method, headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let attempt = 0;
    let waking = false;
    try {
      for (;;) {
        let res;
        try {
          res = await doFetch(url, init);
        } catch (_) {
          throw new ApiError(0, 'NETWORK_ERROR', 'サーバーに接続できません。通信状況を確認してください');
        }
        if (WAKING_STATUSES.includes(res.status) && method === 'GET' && attempt < retry.max) {
          if (!waking) {
            waking = true;
            onWaking(true);
          }
          attempt += 1;
          await sleep(retry.delayMs);
          continue;
        }
        return res;
      }
    } finally {
      if (waking) onWaking(false);
    }
  }

  async function json(method, path, options) {
    const res = await send(method, path, options);
    if (!res.ok) throw await toApiError(res);
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    get: (path, query) => json('GET', path, { query }),
    post: (path, body) => json('POST', path, { body }),
    put: (path, body) => json('PUT', path, { body }),
    del: (path) => json('DELETE', path),
    /** ファイルとして受け取る（CSV など）。{ blob, filename } */
    async download(path, query) {
      const res = await send('GET', path, { query });
      if (!res.ok) throw await toApiError(res);
      const disposition = res.headers.get('content-disposition') || '';
      const match = /filename="?([^";]+)"?/i.exec(disposition);
      return { blob: await res.blob(), filename: match ? match[1] : 'download.csv' };
    },
  };
}
