import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from './AppContext.jsx';

/**
 * API からデータを取得する。deps が変わるか、どこかで bump() が呼ばれると再取得する。
 * 再取得中も前のデータは残す（画面がちらつかない）。古い応答が新しい応答を上書きしない。
 */
export function useResource(loader, deps = []) {
  const { version } = useApp();
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const latest = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    const id = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await loader();
      if (id === latest.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === latest.current) setState((s) => ({ data: s.data, error, loading: false }));
    }
  }, [...deps, version]);

  useEffect(() => {
    run();
    return () => {
      latest.current += 1;
    };
  }, [run]);

  return { ...state, reload: run };
}
