import { useEffect, useRef, useState } from 'react';
import { normalizeText } from '../utils/strings.js';

const DEFAULT_DELAY_MS = 250;

/**
 * Debounced async search: when query (or open) changes, calls fetchItems(trimmedQuery) after delay.
 * @param {string} query - Raw input
 * @param {boolean} open - If false, clears items and does not fetch
 * @param {(q: string) => Promise<unknown[]>} fetchItems - Async function returning array of items
 * @param {number} [delayMs] - Debounce delay
 * @param {(message: string) => void} [onError] - Called with error message on fetch failure
 * @param {string} [errorFallback] - Default error message when fetch throws
 * @returns {{ items: unknown[], isLoading: boolean }}
 */
export function useDebouncedSearch(
  query,
  open,
  fetchItems,
  delayMs = DEFAULT_DELAY_MS,
  onError,
  errorFallback = 'Failed to load.',
) {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    const trimmed = normalizeText(query);
    if (!trimmed) {
      setItems([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        setIsLoading(true);
        const result = await fetchItems(trimmed);
        setItems(Array.isArray(result) ? result : []);
      } catch (err) {
        setItems([]);
        if (typeof onError === 'function') {
          onError(err?.message || errorFallback);
        }
      } finally {
        setIsLoading(false);
      }
    }, delayMs);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [open, query, delayMs, fetchItems, onError, errorFallback]);

  return { items, isLoading };
}
