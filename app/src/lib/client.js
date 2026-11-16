// アプリ全体で使う API クライアント。デモモード（npm run dev:demo）では仮のバックエンドに接続する。
import { createApi } from './api.js';

export const isDemo = import.meta.env.VITE_DEMO === '1';

let wakingListener = null;
export const setWakingListener = (fn) => {
  wakingListener = fn;
};

let demoFetchPromise = null;
const demoFetch = async (url, init) => {
  if (!demoFetchPromise) {
    demoFetchPromise = import('./demoBackend.js').then((m) => m.createDemoBackend({ latencyMs: 150 }).fetch);
  }
  return (await demoFetchPromise)(url, init);
};

export const api = createApi({
  fetchImpl: isDemo ? demoFetch : undefined,
  onWaking: (waking) => {
    if (wakingListener) wakingListener(waking);
  },
});

/** ブラウザでファイルを保存する */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
