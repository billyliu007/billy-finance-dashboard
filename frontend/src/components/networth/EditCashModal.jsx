import { useEffect, useState } from 'react';
import { putJson } from '../../utils/api.js';
import useApiData from '../../hooks/useApiData.js';

export default function EditCashModal({ open, cash, onClose, onSaved, existingComponents = [] }) {
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

  async function handleSave() {
    const nameTrim = String(name).trim() || 'Cash';
    const cur = String(currency || 'CNY').trim().toUpperCase();
    const bal = Number(balance);
    if (!Number.isFinite(bal)) {
      setError('Please enter a valid balance (number).');
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
      setError(err?.message || 'Failed to update.');
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Edit cash">
      <section className="modalCard">
        <header className="modalHeader">
          <h2>Edit Cash / Debt</h2>
          <button type="button" className="modalCloseBtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modalBody">
          <label className="modalLabel">
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="modalInput"
              placeholder="e.g. DBS Savings"
            />
          </label>
          <label className="modalLabel">
            Currency
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
            Balance (negative = debt)
            <input
              type="number"
              step="0.01"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              className="modalInput"
              placeholder="0"
            />
          </label>
          {error && <p className="error">{error}</p>}
        </div>
        <footer className="modalFooter">
          <button type="button" className="modalBtn secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button
            type="button"
            className="modalBtn"
            onClick={handleSave}
            disabled={isSaving || !Number.isFinite(Number(balance))}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </footer>
      </section>
    </div>
  );
}
