import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJson, postJson } from '../../utils/api.js';
import { normalizeText } from '../../utils/strings.js';
import { useDebouncedSearch } from '../../hooks/useDebouncedSearch.js';

export default function AddStockPositionModal({ open, onClose, onSaved }) {
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
    'Failed to load stock symbols.',
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

  async function handleSave() {
    setError('');
    const symbol = normalizeText(selectedSymbol);
    const qtyNum = Number(qty);
    const avgCostNum = Number(avgCost);

    if (!symbol) {
      setError('Please select a stock symbol.');
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError('Quantity must be greater than 0.');
      return;
    }
    if (!normalizeText(avgCost)) {
      setError('Please enter avg cost per unit.');
      return;
    }
    if (!Number.isFinite(avgCostNum) || avgCostNum < 0) {
      setError('Avg cost per unit must be 0 or greater.');
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
      setError(err?.message || 'Failed to save position.');
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Add stock position">
      <section className="modalCard">
        <header className="modalHeader">
          <h2>Add Stock Position</h2>
          <button type="button" className="modalCloseBtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="modalBody">
          <label className="modalLabel">
            Asset
            <input
              value={query}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                if (normalizeText(nextQuery).toUpperCase() !== selectedSymbol) {
                  setSelectedSymbol('');
                }
              }}
              placeholder="Type asset symbol (e.g. QQQ, TSLA, AAPL)"
              className="modalInput"
            />
          </label>

          {!selected && (
            <div className="modalProductList">
              {isLoadingSymbols && <p className="modalHint">Loading symbols...</p>}
              {!isLoadingSymbols && normalizeText(query) && symbols.length === 0 && (
                <p className="modalHint">No matching US stock symbols. Try a different symbol or name.</p>
              )}
              {!isLoadingSymbols && normalizeText(query) && symbols.length > 0 && (
                <ul>
                  {symbols.map((item) => (
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
              Quantity
              <input
                type="number"
                min="0"
                step="0.00000001"
                value={qty}
                onChange={(event) => setQty(event.target.value)}
                className="modalInput"
                disabled={!selected}
                aria-disabled={!selected}
              />
            </label>
            <label className="modalLabel">
              Avg cost per unit
              <input
                type="number"
                min="0"
                step="0.01"
                value={avgCost}
                onChange={(event) => setAvgCost(event.target.value)}
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
            Cancel
          </button>
          <button type="button" className="modalBtn" onClick={handleSave} disabled={isSaving || !selected || !normalizeText(avgCost) || !normalizeText(qty) || Number(qty) <= 0}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </footer>
        <p className="modalDisclaimer">
          List shows US-listed stock and ETF symbols.
        </p>
      </section>
    </div>
  );
}

