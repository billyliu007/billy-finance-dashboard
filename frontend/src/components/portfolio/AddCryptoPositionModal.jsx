import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJson, postJson } from '../../utils/api.js';
import { normalizeText, sanitizeDecimalInput } from '../../utils/strings.js';
import { useDebouncedSearch } from '../../hooks/useDebouncedSearch.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

export default function AddCryptoPositionModal({ open, onClose, onSaved }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qty, setQty] = useState('');
  const [avgCost, setAvgCost] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchProducts = useCallback(async (q) => {
    const res = await fetchJson('/api/market/coinbase-products', {
      params: new URLSearchParams({ q, limit: '200' }),
    });
    return Array.isArray(res?.products) ? res.products : [];
  }, []);
  const { items: products, isLoading: isLoadingProducts } = useDebouncedSearch(
    query,
    open,
    fetchProducts,
    250,
    setError,
    t('errors.failedLoadProducts'),
  );

  useEffect(() => {
    if (!open) return;
    setError('');
    setSelectedProductId('');
    setQty('');
    setAvgCost('');
    setQuery('');
  }, [open]);

  const selected = useMemo(
    () => products.find((item) => item.productId === selectedProductId) || null,
    [products, selectedProductId],
  );

  function handleQuantityChange(e) {
    setQty(sanitizeDecimalInput(e.target.value, { allowNegative: false }));
  }
  function handleAvgCostChange(e) {
    setAvgCost(sanitizeDecimalInput(e.target.value, { allowNegative: true }));
  }

  async function handleSave() {
    setError('');
    const productId = normalizeText(selectedProductId);
    const qtyNum = Number(qty);
    const avgCostNum = Number(avgCost);

    if (!productId) {
      setError(t('errors.selectCoinbaseProduct'));
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError(t('errors.quantityGreaterZero'));
      return;
    }
    if (!normalizeText(avgCost)) {
      setError(t('errors.enterAvgCost'));
      return;
    }
    if (!Number.isFinite(avgCostNum) || avgCostNum < 0) {
      setError(t('errors.avgCostNonNegative'));
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
      setError(err?.message || t('errors.failedSavePosition'));
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={t('modals.addCryptoPosition')}>
      <section className="modalCard">
        <header className="modalHeader">
          <h2>{t('modals.addCryptoPosition')}</h2>
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
                if (normalizeText(nextQuery) !== selectedProductId) {
                  setSelectedProductId('');
                }
              }}
              placeholder={t('modals.placeholderCrypto')}
              className="modalInput"
            />
          </label>

          {!selected && (
            <div className="modalProductList">
              {isLoadingProducts && <p className="modalHint">{t('modals.loadingProducts')}</p>}
              {!isLoadingProducts && normalizeText(query) && products.length === 0 && (
                <p className="modalHint">{t('modals.noMatchingCrypto')}</p>
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
          <button type="button" className="modalBtn" onClick={handleSave} disabled={isSaving || !selected || !normalizeText(avgCost) || !normalizeText(qty) || Number(qty) <= 0}>
            {isSaving ? t('modals.saving') : t('modals.save')}
          </button>
        </footer>
        <p className="modalDisclaimer">
          {t('modals.disclaimerCrypto')}
        </p>
      </section>
    </div>
  );
}

