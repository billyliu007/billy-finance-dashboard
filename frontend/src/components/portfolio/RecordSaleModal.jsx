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
  const [sellPct, setSellPct] = useState(0);
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [feeFlatTotal, setFeeFlatTotal] = useState('');
  const [creditEnabled, setCreditEnabled] = useState(false);
  const [creditCashId, setCreditCashId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setTxDate(todayIsoDate());
    const available = Number(position?.qty) || 0;
    setSellPct(available > 0 ? 100 : 0);
    // When slider is at 100%, we want to sell the full available qty.
    setQty(available > 0 ? String(available) : '');
    setPricePerUnit('');
    setFeeFlatTotal('');
    setCreditEnabled(false);
    setCreditCashId('');
  }, [open]);

  const symbol = String(position?.symbol || '').toUpperCase();
  const displayName = position?.name || symbol;
  const positionCurrency = String(position?.currency || 'USD').toUpperCase();
  const normalizedPosCurrency = normalizeCashCurrency(positionCurrency);
  const isCrypto = /crypto/i.test(String(position?.category || ''));
  const referenceCostPerUnit = Number(position?.purchasePrice) || 0;
  const availableQty = Number(position?.qty) || 0;

  function roundDownQty(value, decimals = 8) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    const factor = 10 ** decimals;
    return Math.floor(num * factor) / factor;
  }

  function handleSellPctChange(e) {
    const pct = Number(e.target.value);
    const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
    setSellPct(safePct);
    if (!(availableQty > 0)) {
      setQty('');
      return;
    }
    const nextQty = safePct >= 100 - 1e-9 ? availableQty : roundDownQty((availableQty * safePct) / 100, 8);
    setQty(nextQty > 0 ? String(nextQty) : '');
  }

  function handleQtyChange(e) {
    const nextRaw = sanitizeDecimalInput(e.target.value, { allowNegative: false });
    setQty(nextRaw);

    if (!(availableQty > 0)) {
      setSellPct(0);
      return;
    }

    const qtyNum = Number(nextRaw);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setSellPct(0);
      return;
    }

    const clamped = Math.min(qtyNum, availableQty);
    if (qtyNum > availableQty + 1e-12) {
      setQty(String(availableQty));
    }

    const pct = availableQty > 0 ? (clamped / availableQty) * 100 : 0;
    setSellPct(Number(Math.max(0, Math.min(100, pct)).toFixed(1)));
  }

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
    const f = Number(feeFlatTotal);
    if (!Number.isFinite(q) || q <= 0) return 0;
    if (!Number.isFinite(p) || p < 0) return 0;
    const fee = Number.isFinite(f) && f >= 0 ? f : 0;
    return Math.max(0, q * p - fee);
  }, [qty, pricePerUnit, feeFlatTotal]);

  useEffect(() => {
    if (!creditEnabled) return;
    if (creditCashId) return;
    if (eligibleCash.length > 0) {
      setCreditCashId(String(eligibleCash[0].id));
    }
  }, [creditEnabled, creditCashId, eligibleCash]);

  function handlePriceChange(e) {
    setPricePerUnit(sanitizeDecimalInput(e.target.value, { allowNegative: false }));
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
    const priceNum = Number(pricePerUnit);
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
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setError(t('errors.sellPricePerUnitNonNegative'));
      return;
    }
    if (feeNum != null && (!Number.isFinite(feeNum) || feeNum < 0)) {
      setError(t('errors.feePerUnitNonNegative'));
      return;
    }
    if (creditEnabled && eligibleCash.length === 0) {
      setError(t('errors.noMatchingCashForCredit'));
      return;
    }
    try {
      setIsSaving(true);
      await postJson(`/api/portfolio/positions/${encodeURIComponent(symbol)}/transactions`, {
        type: 'SELL',
        txDate,
        qty: qtyNum,
        avgCostPerUnit: priceNum,
        feeFlatTotal: feeNum,
        creditCashId: creditEnabled ? creditCashId || null : null,
      });
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err?.message || t('errors.failedSaveSale'));
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) return null;

  const qtyNum = Number(qty);
  const priceNum = Number(pricePerUnit);
  const canSave =
    Number.isFinite(qtyNum) && qtyNum > 0 && Number.isFinite(priceNum) && priceNum >= 0 && !isSaving;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={t('modals.addSale')}>
      <section className="modalCard">
        <header className="modalHeader">
          <h2>{t('modals.addSale')}</h2>
          <button type="button" className="modalCloseBtn" onClick={onClose} aria-label={t('modals.close')}>
            ✕
          </button>
        </header>

        <div className="modalBody">
          <label className="modalLabel">
            {t('modals.asset')}
            <input type="text" value={displayName} readOnly className="modalInput" />
          </label>

          <div className="modalGrid">
            <label className="modalLabel">
              {t('modals.date')}
              <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} className="modalInput" />
            </label>
            <label className="modalLabel">
              {t('modals.sellQty')}
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={qty}
                onChange={handleQtyChange}
                className="modalInput"
                disabled={!(availableQty > 0)}
                placeholder={availableQty > 0 ? `<= ${availableQty}` : '0'}
              />
            </label>
            <label className="modalLabel">
              {t('modals.sellPricePerUnit', { currency: positionCurrency || 'USD' })}
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
              {t('modals.feePerUnit')}
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={feeFlatTotal}
                onChange={handleFeeFlatTotalChange}
                className="modalInput"
              />
            </label>
            <label className="modalLabel">
              {t('modals.costPerUnitReadOnly')}
              <input
                type="text"
                value={Number.isFinite(referenceCostPerUnit) ? referenceCostPerUnit.toFixed(8).replace(/\.?0+$/, '') : ''}
                readOnly
                className="modalInput"
                aria-readonly="true"
              />
            </label>
            <label className="modalLabel">
              {t('modals.sellPct')}
              <input
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={sellPct}
                onChange={handleSellPctChange}
                className="modalRange"
                disabled={!(availableQty > 0)}
              />
              <div className="modalRangeMeta">
                <strong>{Number.isFinite(sellPct) ? `${sellPct.toFixed(1)}%` : '0.0%'}</strong>
                <span>
                  {t('modals.qtyShort')} {qty || '0'}
                </span>
              </div>
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
              {t('modals.addProceedsToCashOptional')}
              {estimatedProceeds > 0 ? t('modals.estimatedSuffix', { value: estimatedProceeds.toFixed(2) }) : ''}
            </label>
          </div>

          {creditEnabled && (
            <label className="modalLabel">
              {t('modals.selectCashAccount')}
              <select className="modalInput" value={creditCashId} onChange={(e) => setCreditCashId(e.target.value)}>
                {eligibleCash.map((c) => (
                  <option key={c.id} value={c.id}>
                    {String(c.currency).toUpperCase()} — {c.name}
                  </option>
                ))}
              </select>
              {isCrypto && (
                <p className="hintText" style={{ marginTop: 6 }}>
                  {t('modals.cryptoCreditsHint')}
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
          <button type="button" className="modalBtn" onClick={handleSave} disabled={!canSave}>
            {isSaving ? t('modals.saving') : t('modals.save')}
          </button>
        </footer>
      </section>
    </div>
  );
}

