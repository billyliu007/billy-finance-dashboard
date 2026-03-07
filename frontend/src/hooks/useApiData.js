import { useEffect, useState } from 'react';
import { fetchJson, getSheetLoadErrorMessage, isAbortError } from '../utils/api.js';

export default function useApiData(path) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function loadData() {
      try {
        setIsLoading(true);
        setError('');
        const response = await fetchJson(path, { signal: controller.signal });
        setData(response);
      } catch (err) {
        if (!isAbortError(err)) {
          setError(err?.message || getSheetLoadErrorMessage());
        }
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
    return () => controller.abort();
  }, [path]);

  return { data, isLoading, error };
}
