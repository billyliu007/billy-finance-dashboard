import { useEffect, useState } from 'react';
import { patchJson } from '../../utils/api.js';
import { normalizeText, sanitizeDecimalInput } from '../../utils/strings.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

export default function EditCryptoPositionModal({ open, position, onClose, onSaved }) {
  const { t } = useLanguage();
  const [qty, setQty] = useState('');
  const [avgCost, setAvgCost] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !position) return;
    setError('');
    setQty(String(position.qty ?? ''));
    setAvgCost(String(position.purchasePrice ?? ''));
  }, [open, position]);

  function handleQuantityChange(e) {
    setQty(sanitizeDecimalInput(e.target.value, { allowNegative: false }));
  }
  function handleAvgCostChange(e) {
    setAvgCost(sanitizeDecimalInput(e.target.value, { allowNegative: true }));
  }

  async function handleSave() {
    setError('');
    const symbol = position?.symbol ? String(position.symbol).trim().toUpperCase() : '';
    const qtyNum = Number(qty);
    const avgCostNum = Number(avgCost);

    if (!symbol) {
      setError(t('errors.missingPosition'));
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
      await patchJson(`/api/portfolio/positions/${encodeURIComponent(symbol)}`, {
        qty: qtyNum,
        avgCostPerUnit: avgCostNum,
      });
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err?.message || t('errors.failedUpdatePosition'));
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) return null;

  const symbol = position?.symbol ?? '';
  const name = position?.name ?? symbol;
  const isCrypto = /crypto/i.test(String(position?.category || ''));

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={isCrypto ? t('modals.editCryptoPosition') : t('modals.editStockPosition')}>
      <section className="modalCard">
        <header className="modalHeader">
          <h2>{isCrypto ? t('modals.editCryptoPosition') : t('modals.editStockPosition')}</h2>
          <button type="button" className="modalCloseBtn" onClick={onClose} aria-label={t('modals.close')}>
            ✕
          </button>
        </header>

        <div className="modalBody">
          <label className="modalLabel">
            {t('modals.asset')}
            <input
              type="text"
              value={name}
              readOnly
              className="modalInput"
              aria-readonly="true"
            />
          </label>

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
            disabled={isSaving || !normalizeText(qty) || !normalizeText(avgCost) || Number(qty) <= 0}
          >
            {isSaving ? t('modals.saving') : t('modals.save')}
          </button>
        </footer>
      </section>
    </div>
  );
}
