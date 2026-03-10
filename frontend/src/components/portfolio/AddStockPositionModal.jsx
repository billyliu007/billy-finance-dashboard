import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson, postJson } from '../../utils/api.js';

function normalizeText(value) {
  return String(value || '').trim();
}

export default function AddStockPositionModal({ open, onClose, onSaved }) {
  const [query, setQuery] = useState('');
  const [symbols, setSymbols] = useState([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [qty, setQty] = useState('');
  const [avgCost, setAvgCost] = useState('');
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError('');
    setSelectedSymbol('');
    setQty('');
    setAvgCost('');
    setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const trimmedQuery = normalizeText(query);
    if (!trimmedQuery) {
      setSymbols([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        setIsLoadingSymbols(true);
        const response = await fetchJson('/api/market/us-stock-symbols', {
          params: new URLSearchParams({ q: trimmedQuery, limit: '50' }),
        });
        setSymbols(Array.isArray(response?.symbols) ? response.symbols : []);
      } catch (err) {
        setSymbols([]);
        setError(err?.message || 'Failed to load stock symbols.');
      } finally {
        setIsLoadingSymbols(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [open, query]);

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
          <button type="button" className="modalBtn" onClick={handleSave} disabled={isSaving || !selected}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </footer>
        <p className="modalDisclaimer">
          List shows US-listed stocks from synced symbol data.
        </p>
      </section>
    </div>
  );
}

