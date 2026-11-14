import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../ui/errors';

/** 読み込みと再読み込み。loader が変わったら読み直す */
export function useLoad<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await loader());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [loader]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload, setData, setError };
}
