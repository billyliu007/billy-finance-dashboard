import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../constants';

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

        const query = params.toString();
        const response = await fetch(`${API_BASE_URL}/api/sheet${query ? `?${query}` : ''}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('Backend returned an error response.');
        }

        const data = await response.json();
        setHeaders(data.headers || []);
        setRows(data.rows || []);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError('Could not load sheet data. Verify backend and Google Sheet settings.');
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
