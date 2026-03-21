/* eslint-disable react-refresh/only-export-components -- ToastProvider + useToast are a paired API */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);

const DEFAULT_DURATION_MS = 5200;

/**
 * @typedef {{ id: number, message: string, variant: 'error' | 'success' | 'info' }} ToastItem
 */

export function ToastProvider({ children }) {
  const idRef = useRef(0);
  const [toasts, setToasts] = useState(() => /** @type {ToastItem[]} */ ([]));
  const timersRef = useRef(new Map());

  const removeToast = useCallback((id) => {
    const t = timersRef.current.get(id);
    if (t) clearTimeout(t);
    timersRef.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const showToast = useCallback(
    (message, options = {}) => {
      const text = String(message || '').trim() || 'Something went wrong.';
      const variant = options.variant === 'success' || options.variant === 'info' ? options.variant : 'error';
      const duration = Number.isFinite(options.duration) ? options.duration : DEFAULT_DURATION_MS;
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, message: text, variant }]);
      const timer = setTimeout(() => removeToast(id), Math.max(1500, duration));
      timersRef.current.set(id, timer);
    },
    [removeToast],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toastRegion" aria-live="polite" aria-relevant="additions text">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.variant}`}
            role="status"
          >
            <span className="toastMessage">{toast.message}</span>
            <button
              type="button"
              className="toastDismiss"
              onClick={() => removeToast(toast.id)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
