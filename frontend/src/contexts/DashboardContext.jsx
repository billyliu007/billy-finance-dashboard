/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { fetchJson, getSheetLoadErrorMessage, isAbortError } from '../utils/api.js';

const DashboardContext = createContext(null);

function normalizeRefreshOptions(opts) {
  const mode = opts?.mode === 'blocking' ? 'blocking' : 'silent';
  return { mode };
}

export function DashboardProvider({ children }) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);
  const [refreshMode, setRefreshMode] = useState('blocking'); // 'blocking' | 'silent'
  const dataRef = useRef(null);

  const refresh = useCallback((opts) => {
    const next = normalizeRefreshOptions(opts);
    setRefreshMode(next.mode);
    setReloadNonce((prev) => prev + 1);
  }, []);

  const mutate = useCallback((updater) => {
    setData((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      dataRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    let isMounted = true;
    let activeController = null;
    const refreshMs = 60_000;

    async function load({ mode = 'blocking' } = {}) {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      try {
        const hasData = dataRef.current != null;
        const effectiveMode = hasData && mode === 'silent' ? 'silent' : 'blocking';
        if (effectiveMode === 'blocking') {
          setIsLoading(true);
        } else {
          setIsRefreshing(true);
        }
        setError('');
        const response = await fetchJson('/api/dashboard', { signal: controller.signal });
        if (isMounted) {
          dataRef.current = response;
          setData(response);
        }
      } catch (err) {
        if (isMounted && !isAbortError(err)) {
          setError(err?.message || getSheetLoadErrorMessage());
        }
      } finally {
        if (isMounted) {
          if (mode === 'blocking' || dataRef.current == null) {
            setIsLoading(false);
          }
          setIsRefreshing(false);
        }
      }
    }

    load({ mode: refreshMode });

    if (refreshMs <= 0) {
      return () => {
        isMounted = false;
        activeController?.abort();
      };
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') load({ mode: 'silent' });
    }, refreshMs);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') load({ mode: 'silent' });
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(intervalId);
      activeController?.abort();
    };
  }, [reloadNonce, refreshMode]);

  const value = {
    netWorth: data?.netWorth ?? null,
    portfolio: data?.portfolio ?? null,
    benchmarks: data?.benchmarks ?? null,
    isLoading,
    isRefreshing,
    error,
    refresh,
    mutate,
  };

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    throw new Error('useDashboard must be used within DashboardProvider');
  }
  return ctx;
}
