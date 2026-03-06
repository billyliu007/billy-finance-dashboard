import { useEffect, useState } from 'react';
import { fetchJson, getSheetLoadErrorMessage, isAbortError } from '../utils/api';

export default function useSheetData(range) {
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function loadSheetData() {
      try {
        setIsLoading(true);
        setError('');

        const params = new URLSearchParams();
        if (range) {
          params.set('range', range);
        }

        const data = await fetchJson('/api/sheet', {
          params,
          signal: controller.signal,
        });
        setHeaders(data.headers || []);
        setRows(data.rows || []);
      } catch (err) {
        if (!isAbortError(err)) {
          setError(getSheetLoadErrorMessage());
        }
      } finally {
        setIsLoading(false);
      }
    }

    loadSheetData();

    return () => controller.abort();
  }, [range]);

  return { headers, rows, isLoading, error };
}
