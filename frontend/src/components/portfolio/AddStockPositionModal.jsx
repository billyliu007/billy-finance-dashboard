import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJson, postJson } from '../../utils/api.js';
import { normalizeText, sanitizeDecimalInput } from '../../utils/strings.js';
import { useDebouncedSearch } from '../../hooks/useDebouncedSearch.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

export default function AddStockPositionModal({ open, onClose, onSaved }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [qty, setQty] = useState('');
  const [avgCost, setAvgCost] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchSymbols = useCallback(async (q) => {
    const res = await fetchJson('/api/market/us-stock-symbols', {
      params: new URLSearchParams({ q, limit: '50' }),
    });
    return Array.isArray(res?.symbols) ? res.symbols : [];
  }, []);
  const { items: symbols, isLoading: isLoadingSymbols } = useDebouncedSearch(
    query,
    open,
    fetchSymbols,
    250,
    setError,
    t('errors.failedLoadSymbols'),
  );

  useEffect(() => {
    if (!open) return;
    setError('');
    setSelectedSymbol('');
    setQty('');
    setAvgCost('');
    setQuery('');
  }, [open]);

  const selected = useMemo(
    () => symbols.find((item) => item.symbol === selectedSymbol) || null,
    [symbols, selectedSymbol],
  );

  const symbolsSorted = useMemo(() => {
    const q = normalizeText(query).toUpperCase();
    if (!q || symbols.length === 0) return symbols;
    const exact = symbols.find((s) => String(s.symbol || '').toUpperCase() === q);
    if (!exact) return symbols;
    return [exact, ...symbols.filter((s) => String(s.symbol || '').toUpperCase() !== q)];
  }, [symbols, query]);

  function handleQuantityChange(e) {
    setQty(sanitizeDecimalInput(e.target.value, { allowNegative: false }));
  }
  function handleAvgCostChange(e) {
    setAvgCost(sanitizeDecimalInput(e.target.value, { allowNegative: true }));
  }

  async function handleSave() {
    setError('');
    const symbol = normalizeText(selectedSymbol);
    const qtyNum = Number(qty);
    const avgCostNum = normalizeText(avgCost) ? Number(avgCost) : 0;

    if (!symbol) {
      setError(t('errors.selectStockSymbol'));
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum < 0) {
      setError(t('errors.quantityNonNegative'));
      return;
    }
    if (qtyNum > 0 && !normalizeText(avgCost)) {
      setError(t('errors.enterAvgCost'));
      return;
    }
    if (!Number.isFinite(avgCostNum) || avgCostNum < 0) {
      setError(t('errors.avgCostNonNegative'));
      return;
    }

    try {
      setIsSaving(true);
      await postJson('/api/portfolio/positions/stock', {
        symbol,
        qty: qtyNum,
        avgCostPerUnit: avgCostNum,
      });
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err?.message || t('errors.failedSavePosition'));
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={t('modals.addStockPosition')}>
      <section className="modalCard">
        <header className="modalHeader">
          <h2>{t('modals.addStockPosition')}</h2>
          <button type="button" className="modalCloseBtn" onClick={onClose} aria-label={t('modals.close')}>
            ✕
          </button>
        </header>

        <div className="modalBody">
          <label className="modalLabel">
            {t('modals.asset')}
            <input
              value={query}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                if (normalizeText(nextQuery).toUpperCase() !== selectedSymbol) {
                  setSelectedSymbol('');
                }
              }}
              placeholder={t('modals.placeholderStock')}
              className="modalInput"
            />
          </label>

          {!selected && (
            <div className="modalProductList">
              {isLoadingSymbols && <p className="modalHint">{t('modals.loadingSymbols')}</p>}
              {!isLoadingSymbols && normalizeText(query) && symbols.length === 0 && (
                <p className="modalHint">{t('modals.noMatchingStock')}</p>
              )}
              {!isLoadingSymbols && normalizeText(query) && symbolsSorted.length > 0 && (
                <ul>
                  {symbolsSorted.map((item) => (
                    <li key={item.symbol}>
                      <button
                        type="button"
                        className="modalProductItem"
                        onClick={() => {
                          setSelectedSymbol(item.symbol);
                          setQuery(item.symbol);
                        }}
                      >
                        <span className="modalProductMain">{item.symbol}</span>
                        {item.securityName && (
                          <span className="modalProductSub">{item.securityName}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="modalGrid">
            <label className="modalLabel">
              {t('modals.quantity')}
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={qty}
                onChange={handleQuantityChange}
                className="modalInput"
                disabled={!selected}
                aria-disabled={!selected}
              />
            </label>
            <label className="modalLabel">
              {t('modals.avgCostPerUnit')}
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={avgCost}
                onChange={handleAvgCostChange}
                className="modalInput"
                disabled={!selected}
                aria-disabled={!selected}
              />
            </label>
          </div>

          {error && <p className="error">{error}</p>}
        </div>

        <footer className="modalFooter">
          <button type="button" className="modalBtn secondary" onClick={onClose} disabled={isSaving}>
            {t('modals.cancel')}
          </button>
          <button
            type="button"
            className="modalBtn"
            onClick={handleSave}
            disabled={isSaving || !selected || !normalizeText(qty) || Number(qty) < 0 || (Number(qty) > 0 && !normalizeText(avgCost))}
          >
            {isSaving ? t('modals.saving') : t('modals.save')}
          </button>
        </footer>
        <p className="modalDisclaimer">
          {t('modals.disclaimerStock')}
        </p>
      </section>
    </div>
  );
}

