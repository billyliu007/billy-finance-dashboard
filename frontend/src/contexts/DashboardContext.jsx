/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { fetchJson, getSheetLoadErrorMessage, isAbortError } from '../utils/api.js';

const DashboardContext = createContext(null);

export function DashboardProvider({ children }) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);

  const refresh = useCallback(() => {
    setReloadNonce((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let isMounted = true;
    let activeController = null;
    const refreshMs = 60_000;

    async function load(showLoading = true) {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      try {
        if (showLoading) setIsLoading(true);
        setError('');
        const response = await fetchJson('/api/dashboard', { signal: controller.signal });
        if (isMounted) {
          setData(response);
        }
      } catch (err) {
        if (isMounted && !isAbortError(err)) {
          setError(err?.message || getSheetLoadErrorMessage());
        }
      } finally {
        if (isMounted && showLoading) {
          setIsLoading(false);
        }
      }
    }

    load(true);

    if (refreshMs <= 0) {
      return () => {
        isMounted = false;
        activeController?.abort();
      };
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(false);
    }, refreshMs);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') load(false);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(intervalId);
      activeController?.abort();
    };
  }, [reloadNonce]);

  const value = {
    netWorth: data?.netWorth ?? null,
    portfolio: data?.portfolio ?? null,
    isLoading,
    error,
    refresh,
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
