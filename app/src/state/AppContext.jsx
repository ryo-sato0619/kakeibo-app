import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setWakingListener } from '../lib/client.js';

const AppContext = createContext(null);

export const useApp = () => useContext(AppContext);

/**
 * 画面をまたいで共有するもの:
 *  - version / bump(): データを更新したら呼ぶと、各画面が再取得する
 *  - masters: 口座とカテゴリ（入力フォームの選択肢）
 *  - waking: DB の起動待ち表示
 *  - notify(): 完了メッセージ
 *  - openTxForm(): 取引の入力・編集フォームを開く
 */
export function AppProvider({ children }) {
  const [version, setVersion] = useState(0);
  const [waking, setWaking] = useState(false);
  const [toast, setToast] = useState(null);
  const [txForm, setTxForm] = useState(null);
  const [masters, setMasters] = useState({ accounts: [], categories: [], loaded: false, error: null });

  useEffect(() => {
    setWakingListener(setWaking);
    return () => setWakingListener(null);
  }, []);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [accounts, categories] = await Promise.all([api.get('/api/accounts'), api.get('/api/categories')]);
        if (!cancelled) setMasters({ accounts, categories, loaded: true, error: null });
      } catch (error) {
        if (!cancelled) setMasters((m) => ({ ...m, loaded: true, error }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  const notify = useCallback((message, kind = 'success') => setToast({ message, kind, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const openTxForm = useCallback((options = {}) => setTxForm(options), []);
  const closeTxForm = useCallback(() => setTxForm(null), []);

  const value = useMemo(
    () => ({ version, bump, waking, masters, toast, notify, txForm, openTxForm, closeTxForm }),
    [version, bump, waking, masters, toast, notify, txForm, openTxForm, closeTxForm],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
