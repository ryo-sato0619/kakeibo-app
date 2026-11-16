// 画面の切り替え（#/home のようなハッシュで管理。サーバー側の設定が不要）
export const ROUTES = ['home', 'history', 'accounts', 'savings', 'reports', 'settings'];

export function parseHash(hash) {
  const name = String(hash || '')
    .replace(/^#\/?/, '')
    .split(/[/?]/)[0];
  return ROUTES.includes(name) ? name : 'home';
}

export const hrefFor = (name) => `#/${name}`;
