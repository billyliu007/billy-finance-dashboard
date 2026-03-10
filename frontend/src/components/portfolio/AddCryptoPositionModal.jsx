import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson, postJson } from '../../utils/api.js';

function normalizeText(value) {
  return String(value || '').trim();
}

export default function AddCryptoPositionModal({ open, onClose, onSaved }) {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qty, setQty] = useState('');
  const [avgCost, setAvgCost] = useState('');
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError('');
    setSelectedProductId('');
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
      setProducts([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        setIsLoadingProducts(true);
        const response = await fetchJson('/api/market/coinbase-products', {
          params: new URLSearchParams({ q: trimmedQuery, limit: '200' }),
        });
        setProducts(Array.isArray(response?.products) ? response.products : []);
      } catch (err) {
        setProducts([]);
        setError(err?.message || 'Failed to load Coinbase products.');
      } finally {
        setIsLoadingProducts(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [open, query]);

  const selected = useMemo(
    () => products.find((item) => item.productId === selectedProductId) || null,
    [products, selectedProductId],
  );

  async function handleSave() {
    setError('');
    const productId = normalizeText(selectedProductId);
    const qtyNum = Number(qty);
    const avgCostNum = Number(avgCost);

    if (!productId) {
      setError('Please select a Coinbase product.');
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
      await postJson('/api/portfolio/positions/crypto', {
        productId,
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
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Add crypto position">
      <section className="modalCard">
        <header className="modalHeader">
          <h2>Add Crypto Position</h2>
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
                if (normalizeText(nextQuery) !== selectedProductId) {
                  setSelectedProductId('');
                }
              }}
              placeholder="Type asset name or symbol (e.g. BTC, ETH, BTC-USDT)"
              className="modalInput"
            />
          </label>

          {!selected && (
            <div className="modalProductList">
              {isLoadingProducts && <p className="modalHint">Loading products...</p>}
              {!isLoadingProducts && normalizeText(query) && products.length === 0 && (
                <p className="modalHint">No matching Coinbase products. Try a different asset name or symbol.</p>
              )}
              {!isLoadingProducts && normalizeText(query) && products.length > 0 && (
                <ul>
                  {products.map((item) => (
                    <li key={item.productId}>
                      <button
                        type="button"
                        className="modalProductItem"
                        onClick={() => {
                          setSelectedProductId(item.productId);
                          setQuery(item.productId);
                        }}
                      >
                        <span className="modalProductMain">
                          {item.baseCurrency}/{item.quoteCurrency}
                        </span>
                        <span className="modalProductSub">{item.productId}</span>
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
          List shows Coinbase products in USDT and USDC pairs only.
        </p>
      </section>
    </div>
  );
}

