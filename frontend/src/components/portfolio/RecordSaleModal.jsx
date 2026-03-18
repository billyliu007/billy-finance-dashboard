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

export default function RecordSaleModal({ open, position, cashComponents, onClose, onSaved }) {
  const { t } = useLanguage();
  const [txDate, setTxDate] = useState(todayIsoDate());
  const [qty, setQty] = useState('');
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [creditEnabled, setCreditEnabled] = useState(false);
  const [creditCashId, setCreditCashId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setTxDate(todayIsoDate());
    setQty('');
    setPricePerUnit('');
    setCreditEnabled(false);
    setCreditCashId('');
  }, [open]);

  const symbol = String(position?.symbol || '').toUpperCase();
  const displayName = position?.name || symbol;
  const positionCurrency = String(position?.currency || 'USD').toUpperCase();
  const normalizedPosCurrency = normalizeCashCurrency(positionCurrency);
  const isCrypto = /crypto/i.test(String(position?.category || ''));
  const referenceCostPerUnit = Number(position?.purchasePrice) || 0;

  const eligibleCash = useMemo(() => {
    const list = Array.isArray(cashComponents) ? cashComponents : [];
    if (isCrypto) {
      return list.filter((c) => ['USDT', 'USDC'].includes(String(c?.currency || '').toUpperCase()));
    }
    if (normalizedPosCurrency === 'USD') {
      return list.filter((c) => String(c?.currency || '').trim().toUpperCase() === 'USD');
    }
    return list.filter((c) => String(c?.currency || '').trim().toUpperCase() === normalizedPosCurrency);
  }, [cashComponents, isCrypto, normalizedPosCurrency]);

  const estimatedProceeds = useMemo(() => {
    const q = Number(qty);
    const p = Number(pricePerUnit);
    if (!Number.isFinite(q) || q <= 0) return 0;
    if (!Number.isFinite(p) || p < 0) return 0;
    return q * p;
  }, [qty, pricePerUnit]);

  useEffect(() => {
    if (!creditEnabled) return;
    if (creditCashId) return;
    if (eligibleCash.length > 0) {
      setCreditCashId(String(eligibleCash[0].id));
    }
  }, [creditEnabled, creditCashId, eligibleCash]);

  function handleQtyChange(e) {
    setQty(sanitizeDecimalInput(e.target.value, { allowNegative: false }));
  }

  function handlePriceChange(e) {
    setPricePerUnit(sanitizeDecimalInput(e.target.value, { allowNegative: false }));
  }

  async function handleSave() {
    setError('');
    if (!symbol) {
      setError(t('errors.missingPosition'));
      return;
    }
    const qtyNum = Number(qty);
    const priceNum = Number(pricePerUnit);
    if (!txDate) {
      setError('Date is required.');
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError(t('errors.quantityGreaterZero'));
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setError('Sell price per unit must be 0 or greater.');
      return;
    }
    if (creditEnabled && eligibleCash.length === 0) {
      setError('No matching cash account found for credit.');
      return;
    }
    try {
      setIsSaving(true);
      await postJson(`/api/portfolio/positions/${encodeURIComponent(symbol)}/transactions`, {
        type: 'SELL',
        txDate,
        qty: qtyNum,
        avgCostPerUnit: priceNum,
        creditCashId: creditEnabled ? creditCashId || null : null,
      });
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Failed to save sale.');
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Add sale">
      <section className="modalCard">
        <header className="modalHeader">
          <h2>Add sale</h2>
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
              Sell price per unit ({positionCurrency || 'USD'})
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={pricePerUnit}
                onChange={handlePriceChange}
                className="modalInput"
              />
            </label>
            <label className="modalLabel">
              Cost per unit (avg cost, read-only)
              <input
                type="text"
                value={Number.isFinite(referenceCostPerUnit) ? referenceCostPerUnit.toFixed(8).replace(/\.?0+$/, '') : ''}
                readOnly
                className="modalInput"
                aria-readonly="true"
              />
            </label>
          </div>

          <div className="privacyToggle" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={creditEnabled}
              onChange={(e) => setCreditEnabled(e.target.checked)}
              id="creditCashToggle"
            />
            <label htmlFor="creditCashToggle">
              Add proceeds to cash (optional){estimatedProceeds > 0 ? ` — est. ${estimatedProceeds.toFixed(2)}` : ''}
            </label>
          </div>

          {creditEnabled && (
            <label className="modalLabel">
              Select cash account
              <select className="modalInput" value={creditCashId} onChange={(e) => setCreditCashId(e.target.value)}>
                {eligibleCash.map((c) => (
                  <option key={c.id} value={c.id}>
                    {String(c.currency).toUpperCase()} — {c.name}
                  </option>
                ))}
              </select>
              {isCrypto && (
                <p className="hintText" style={{ marginTop: 6 }}>
                  Crypto credits are limited to USDT/USDC cash accounts for consistency; either stablecoin can be used (1:1).
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

