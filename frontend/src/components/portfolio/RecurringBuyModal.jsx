import { useState } from 'react';
import { patchJson, postJson } from '../../utils/api.js';
import { sanitizeDecimalInput } from '../../utils/strings.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

const isStable = (code) => code === 'USDT' || code === 'USDC';
const upper = (value) => String(value || '').trim().toUpperCase();
const toInput = (value, digits) => Number(value).toFixed(digits).replace(/\.?0+$/, '');

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/** Add or edit one recurring buy row. Mount only while open; pass `transaction` to edit. */
export default function RecurringBuyModal({ position, transaction = null, cashComponents, onClose, onSaved }) {
  const { t } = useLanguage();
  const symbol = upper(position?.symbol || position?.key);
  const currency = upper(position?.currency) || 'USD';
  const oldInvested = transaction ? Number(transaction.qty) * Number(transaction.avgCostPerUnit) : 0;

  const [name, setName] = useState(transaction?.notes || '');
  const [txDate, setTxDate] = useState(transaction?.txDate || todayIsoDate());
  const [invested, setInvested] = useState(transaction ? toInput(oldInvested, 6) : '');
  const [qty, setQty] = useState(transaction ? toInput(transaction.qty, 8) : '');
  const [cashId, setCashId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const eligibleCash = (cashComponents || []).filter((c) =>
    isStable(currency) ? isStable(upper(c?.currency)) : upper(c?.currency) === currency,
  );
  const investedNum = Number(invested);
  const qtyNum = Number(qty);
  const isValid = investedNum > 0 && qtyNum > 0;
  const avgCost = isValid ? investedNum / qtyNum : null;
  const price = Number(position?.currentPrice) || 0;
  const pnl = isValid && price > 0 ? qtyNum * price - investedNum : null;
  const cash = eligibleCash.find((c) => String(c.id) === cashId);
  const cashDelta = isValid ? oldInvested - investedNum : 0;
  const money = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  async function handleSave() {
    if (isSaving) return;
    if (!name.trim()) return setError(t('recurring.nameRequired'));
    if (!txDate) return setError(t('errors.dateRequired'));
    if (!isValid) return setError(t('recurring.totalsRequired'));
    const body = { name: name.trim(), txDate, totalInvested: investedNum, totalQty: qtyNum, cashId: cashId || null };
    try {
      setIsSaving(true);
      setError('');
      if (transaction) await patchJson(`/api/portfolio/recurring-buys/${encodeURIComponent(transaction.id)}`, body);
      else await postJson(`/api/portfolio/positions/${encodeURIComponent(symbol)}/recurring-buys`, body);
      onClose?.();
      onSaved?.();
    } catch (err) {
      setError(err?.message || t('errors.failedSavePosition'));
      setIsSaving(false);
    }
    return undefined;
  }

  const title = transaction ? t('recurring.editTitle') : t('recurring.addTitle');
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={title}>
      <section className="modalCard">
        <header className="modalHeader">
          <h2>{title}</h2>
          <button type="button" className="modalCloseBtn" onClick={onClose} aria-label={t('modals.close')}>
            ✕
          </button>
        </header>
        <div className="modalBody">
          <p className="modalHint">{t('recurring.hint')}</p>
          <div className="modalGrid">
            <label className="modalLabel">
              {t('recurring.name')}
              <input type="text" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className="modalInput" />
            </label>
            <label className="modalLabel">
              {t('recurring.startDate')}
              <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} className="modalInput" />
            </label>
            <label className="modalLabel">
              {t('recurring.totalInvested', { currency })}
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={invested}
                onChange={(e) => setInvested(sanitizeDecimalInput(e.target.value))}
                className="modalInput"
              />
            </label>
            <label className="modalLabel">
              {t('recurring.totalQty', { symbol })}
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={qty}
                onChange={(e) => setQty(sanitizeDecimalInput(e.target.value))}
                className="modalInput"
              />
            </label>
          </div>
          <label className="modalLabel">
            {transaction ? t('recurring.cashDifference') : t('recurring.cashTotal')}
            <select className="modalInput" value={cashId} onChange={(e) => setCashId(e.target.value)}>
              <option value="">{t('recurring.noCash')}</option>
              {eligibleCash.map((c) => (
                <option key={c.id} value={c.id}>
                  {upper(c.currency)} — {c.name}
                </option>
              ))}
            </select>
          </label>
          {isValid && (
            <div className="recurringPreview">
              <div>{t('portfolio.avgCostPerUnit')}: <strong>{money(avgCost)} {currency}</strong></div>
              {pnl != null && (
                <div>
                  {t('portfolio.unrealizedGainLoss')}:{' '}
                  <strong className={pnl >= 0 ? 'pos' : 'neg'}>
                    {money(pnl)} ({((pnl / investedNum) * 100).toFixed(2)}%)
                  </strong>
                </div>
              )}
              {cash && (
                <div>
                  {cash.name}: <strong>{money(Number(cash.balance))} → {money(Number(cash.balance) + cashDelta)}</strong>
                </div>
              )}
            </div>
          )}
          {error && <p className="error" role="alert">{error}</p>}
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
