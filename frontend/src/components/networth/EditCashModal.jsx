import { useEffect, useState } from 'react';
import { putJson } from '../../utils/api.js';
import useApiData from '../../hooks/useApiData.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

export default function EditCashModal({ open, cash, onClose, onSaved, existingComponents = [] }) {
  const { t } = useLanguage();
  const { data: currenciesData } = useApiData('/api/currencies', { refreshMs: 0 });
  const currencies = currenciesData?.currencies ?? [];
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('CNY');
  const [balance, setBalance] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !cash) return;
    setError('');
    setName(String(cash.name ?? '').trim());
    setCurrency(String(cash.currency ?? 'CNY').toUpperCase());
    setBalance(String(cash.balance ?? ''));
  }, [open, cash]);

  function handleBalanceChange(e) {
    let raw = e.target.value;
    if (raw === '' || raw === '-') {
      setBalance(raw);
      return;
    }
    raw = raw.replace(/[^\d.-]/g, '');
    if (raw.indexOf('-') > 0) raw = raw.replace(/-/g, '');
    const sanitized = raw.replace(/^([^.]*\.)(.*)$/, (_, a, b) => a + (b.replace(/\./g, '') || ''));
    setBalance(sanitized);
  }

  async function handleSave() {
    const nameTrim = String(name).trim() || 'Cash';
    const cur = String(currency || 'CNY').trim().toUpperCase();
    const bal = Number(balance);
    if (!Number.isFinite(bal)) {
      setError(t('errors.validBalance'));
      return;
    }
    if (bal === 0) {
      setError(t('errors.balanceCannotBeZero'));
      return;
    }
    const id = cash?.id;
    try {
      setIsSaving(true);
      setError('');
      const nextList = existingComponents.map((c) =>
        c.id === id ? { name: nameTrim, currency: cur, balance: bal } : { name: c.name, currency: c.currency, balance: c.balance }
      );
      await putJson('/api/cash', { cashComponents: nextList });
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err?.message || t('errors.failedUpdate'));
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={t('modals.editCashDebt')}>
      <section className="modalCard">
        <header className="modalHeader">
          <h2>{t('modals.editCashDebt')}</h2>
          <button type="button" className="modalCloseBtn" onClick={onClose} aria-label={t('modals.close')}>
            ✕
          </button>
        </header>
        <div className="modalBody">
          <label className="modalLabel">
            {t('modals.name')}
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="modalInput"
              placeholder={t('modals.placeholderName')}
            />
          </label>
          <label className="modalLabel">
            {t('modals.currency')}
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="modalSelect"
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} – {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="modalLabel">
            {t('modals.balanceNegativeDebt')}
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={balance}
              onChange={handleBalanceChange}
              className="modalInput"
              placeholder={t('modals.placeholderBalance')}
            />
          </label>
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
            disabled={isSaving || !Number.isFinite(Number(balance)) || Number(balance) === 0}
          >
            {isSaving ? t('modals.saving') : t('modals.save')}
          </button>
        </footer>
      </section>
    </div>
  );
}
