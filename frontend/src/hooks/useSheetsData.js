import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../constants';

export default function useSheetsData(ranges) {
  const normalizedRanges = Array.isArray(ranges)
    ? ranges.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const rangesKey = normalizedRanges.join('\u0001');
  const stableRanges = useMemo(
    () => (rangesKey ? rangesKey.split('\u0001') : []),
    [rangesKey],
  );

  const [sheets, setSheets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (stableRanges.length === 0) {
      setSheets([]);
      setIsLoading(false);
      setError('');
      return;
    }

    const controller = new AbortController();

    async function loadSheetsData() {
      try {
        setIsLoading(true);
        setError('');

        const params = new URLSearchParams();
        params.set('ranges', stableRanges.join(','));

        const response = await fetch(`${API_BASE_URL}/api/sheets?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('Backend returned an error response.');
        }

        const data = await response.json();
        setSheets(Array.isArray(data.sheets) ? data.sheets : []);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError('Could not load sheet data. Verify backend and Google Sheet settings.');
        }
      } finally {
        setIsLoading(false);
      }
    }

    loadSheetsData();

    return () => controller.abort();
  }, [stableRanges]);

  return { sheets, isLoading, error };
}
