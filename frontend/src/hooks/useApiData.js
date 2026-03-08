import { useEffect, useState } from 'react';
import { fetchJson, getSheetLoadErrorMessage, isAbortError } from '../utils/api.js';

export default function useApiData(path, { refreshMs = 0 } = {}) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;
    let isFetching = false;
    let activeController = null;

    async function loadData({ showLoading = false } = {}) {
      if (isFetching) {
        return;
      }

      isFetching = true;
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;

      try {
        if (showLoading) {
          setIsLoading(true);
        }
        setError('');
        const response = await fetchJson(path, { signal: controller.signal });
        if (isMounted) {
          setData(response);
        }
      } catch (err) {
        if (isMounted && !isAbortError(err)) {
          setError(err?.message || getSheetLoadErrorMessage());
        }
      } finally {
        if (showLoading && isMounted) {
          setIsLoading(false);
        }
        isFetching = false;
      }
    }

    loadData({ showLoading: true });

    if (refreshMs <= 0) {
      return () => {
        isMounted = false;
        activeController?.abort();
      };
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadData();
      }
    }, refreshMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(intervalId);
      activeController?.abort();
    };
  }, [path, refreshMs]);

  return { data, isLoading, error };
}
