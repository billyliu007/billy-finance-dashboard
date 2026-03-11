import { useEffect, useState } from 'react';
import { putJson } from '../../utils/api.js';
import useApiData from '../../hooks/useApiData.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

export default function AddCashModal({ open, onClose, onSaved, existingComponents = [] }) {
  const { t } = useLanguage();
  const { data: currenciesData } = useApiData('/api/currencies', { refreshMs: 0 });
  const currencies = currenciesData?.currencies ?? [];
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('CNY');
  const [balance, setBalance] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setName('');
    setCurrency('CNY');
    setBalance('');
  }, [open]);

  async function handleSave() {
    const nameTrim = String(name).trim() || 'Cash';
    const cur = String(currency || 'CNY').trim().toUpperCase();
    const bal = Number(balance);
    if (!Number.isFinite(bal)) {
      setError(t('errors.validBalance'));
      return;
    }
    try {
      setIsSaving(true);
      setError('');
      const nextList = [...existingComponents.map((c) => ({ name: c.name, currency: c.currency, balance: c.balance })), { name: nameTrim, currency: cur, balance: bal }];
      await putJson('/api/cash', { cashComponents: nextList });
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err?.message || t('errors.failedAddCash'));
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={t('modals.addCashDebt')}>
      <section className="modalCard">
        <header className="modalHeader">
          <h2>{t('modals.addCashDebt')}</h2>
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
              type="number"
              step="0.01"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
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
            disabled={isSaving || !Number.isFinite(Number(balance))}
          >
            {isSaving ? t('modals.saving') : t('modals.add')}
          </button>
        </footer>
      </section>
    </div>
  );
}
