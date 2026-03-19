import { useEffect, useMemo, useState } from 'react';
import { postJson } from '../../utils/api.js';
import { sanitizeDecimalInput } from '../../utils/strings.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeCashCurrency(code) {
  const c = String(code || '').trim().toUpperCase();
  if (c === 'USDT' || c === 'USDC') return 'USD';
  return c;
}

export default function RecordPurchaseModal({ open, position, cashComponents, onClose, onSaved }) {
  const { t } = useLanguage();
  const [txDate, setTxDate] = useState(todayIsoDate());
  const [qty, setQty] = useState('');
  const [avgCost, setAvgCost] = useState('');
  const [feeFlatTotal, setFeeFlatTotal] = useState('');
  const [deductEnabled, setDeductEnabled] = useState(false);
  const [deductCashId, setDeductCashId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setTxDate(todayIsoDate());
    setQty('');
    setAvgCost('');
    setFeeFlatTotal('');
    setDeductEnabled(false);
    setDeductCashId('');
  }, [open]);

  const symbol = String(position?.symbol || '').toUpperCase();
  const displayName = position?.name || symbol;
  const positionCurrency = String(position?.currency || 'USD').toUpperCase();
  const normalizedPosCurrency = normalizeCashCurrency(positionCurrency);
  const isCrypto = /crypto/i.test(String(position?.category || ''));

  const eligibleCash = useMemo(() => {
    const list = Array.isArray(cashComponents) ? cashComponents : [];
    // For crypto deductions, only allow USDT/USDC cash (not USD), but allow either stablecoin regardless of the pair.
    if (isCrypto) {
      return list.filter((c) => ['USDT', 'USDC'].includes(String(c?.currency || '').toUpperCase()));
    }
    // For non-crypto (US stocks): only allow true USD cash accounts (exclude USDT/USDC).
    if (normalizedPosCurrency === 'USD') {
      return list.filter((c) => String(c?.currency || '').trim().toUpperCase() === 'USD');
    }
    return list.filter((c) => String(c?.currency || '').trim().toUpperCase() === normalizedPosCurrency);
  }, [cashComponents, isCrypto, normalizedPosCurrency]);

  const estimatedCost = useMemo(() => {
    const q = Number(qty);
    const c = Number(avgCost);
    const f = Number(feeFlatTotal);
    if (!Number.isFinite(q) || q <= 0) return 0;
    if (!Number.isFinite(c) || c < 0) return 0;
    const fee = Number.isFinite(f) && f >= 0 ? f : 0;
    return q * c + fee;
  }, [qty, avgCost, feeFlatTotal]);

  useEffect(() => {
    if (!deductEnabled) return;
    if (deductCashId) return;
    if (eligibleCash.length > 0) {
      setDeductCashId(String(eligibleCash[0].id));
    }
  }, [deductEnabled, deductCashId, eligibleCash]);

  function handleQtyChange(e) {
    setQty(sanitizeDecimalInput(e.target.value, { allowNegative: false }));
  }

  function handleAvgCostChange(e) {
    setAvgCost(sanitizeDecimalInput(e.target.value, { allowNegative: false }));
  }

  function handleFeeFlatTotalChange(e) {
    setFeeFlatTotal(sanitizeDecimalInput(e.target.value, { allowNegative: false }));
  }

  async function handleSave() {
    setError('');
    if (!symbol) {
      setError(t('errors.missingPosition'));
      return;
    }
    const qtyNum = Number(qty);
    const avgCostNum = Number(avgCost);
    const feeNumRaw = feeFlatTotal.trim() === '' ? null : Number(feeFlatTotal);
    const feeNum = feeNumRaw == null ? null : feeNumRaw;
    if (!txDate) {
      setError(t('errors.dateRequired'));
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError(t('errors.quantityGreaterZero'));
      return;
    }
    if (!Number.isFinite(avgCostNum) || avgCostNum < 0) {
      setError(t('errors.avgCostNonNegative'));
      return;
    }
    if (feeNum != null && (!Number.isFinite(feeNum) || feeNum < 0)) {
      setError(t('errors.feePerUnitNonNegative'));
      return;
    }
    if (deductEnabled && eligibleCash.length === 0) {
      setError(t('errors.noMatchingCashForDeduction'));
      return;
    }
    try {
      setIsSaving(true);
      await postJson(`/api/portfolio/positions/${encodeURIComponent(symbol)}/transactions`, {
        txDate,
        qty: qtyNum,
        avgCostPerUnit: avgCostNum,
        feeFlatTotal: feeNum,
        deductCashId: deductEnabled ? deductCashId || null : null,
      });
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err?.message || t('errors.failedSavePosition'));
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Add purchase">
      <section className="modalCard">
        <header className="modalHeader">
          <h2>Add purchase</h2>
          <button type="button" className="modalCloseBtn" onClick={onClose} aria-label={t('modals.close')}>
            ✕
          </button>
        </header>

        <div className="modalBody">
          <label className="modalLabel">
            Asset
            <input type="text" value={displayName} readOnly className="modalInput" />
          </label>

          <div className="modalGrid">
            <label className="modalLabel">
              Date
              <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} className="modalInput" />
            </label>
            <label className="modalLabel">
              Quantity
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={qty}
                onChange={handleQtyChange}
                className="modalInput"
              />
            </label>
            <label className="modalLabel">
              Avg cost per unit ({positionCurrency || 'USD'})
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={avgCost}
                onChange={handleAvgCostChange}
                className="modalInput"
              />
            </label>
            <label className="modalLabel">
              Fee (flat, optional)
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={feeFlatTotal}
                onChange={handleFeeFlatTotalChange}
                className="modalInput"
              />
            </label>
          </div>

          <div className="privacyToggle" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={deductEnabled}
              onChange={(e) => setDeductEnabled(e.target.checked)}
              id="deductCashToggle"
            />
            <label htmlFor="deductCashToggle">
              Deduct from cash (optional){estimatedCost > 0 ? ` — est. ${estimatedCost.toFixed(2)}` : ''}
            </label>
          </div>

          {deductEnabled && (
            <label className="modalLabel">
              {t('modals.selectCashAccount')}
              <select
                className="modalInput"
                value={deductCashId}
                onChange={(e) => setDeductCashId(e.target.value)}
              >
                {eligibleCash.map((c) => (
                  <option key={c.id} value={c.id}>
                    {String(c.currency).toUpperCase()} — {c.name}
                  </option>
                ))}
              </select>
              {isCrypto && (
                <p className="hintText" style={{ marginTop: 6 }}>
                  {t('modals.cryptoDeductionsHint')}
                </p>
              )}
            </label>
          )}

          {error && <p className="error">{error}</p>}
        </div>

        <footer className="modalFooter">
          <button type="button" className="modalBtn secondary" onClick={onClose} disabled={isSaving}>
            {t('modals.cancel')}
          </button>
          <button type="button" className="modalBtn" onClick={handleSave} disabled={isSaving}>
            {isSaving ? t('modals.saving') : t('modals.save')}
          </button>
        </footer>
      </section>
    </div>
  );
}

