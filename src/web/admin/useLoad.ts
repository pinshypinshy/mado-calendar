import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../ui/errors';

/**
 * 読み込みと再読み込み。loader が変わったら、前のデータを消して読み直す。
 * 応答が前後して届いても、最後に始めた読み込みの結果だけを使う（別の週の予定が出るのを防ぐ）。
 */
export function useLoad<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const result = await loader();
      if (mine !== seq.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (mine === seq.current) setError(errorMessage(e));
    }
  }, [loader]);
  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);
  return { data, error, reload, setData, setError };
}
