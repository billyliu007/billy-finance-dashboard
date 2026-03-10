import { useEffect, useState } from 'react';
import { patchJson } from '../../utils/api.js';
import { normalizeText } from '../../utils/strings.js';

export default function EditCryptoPositionModal({ open, position, onClose, onSaved }) {
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

  async function handleSave() {
    setError('');
    const symbol = position?.symbol ? String(position.symbol).trim().toUpperCase() : '';
    const qtyNum = Number(qty);
    const avgCostNum = Number(avgCost);

    if (!symbol) {
      setError('Missing position.');
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError('Quantity must be greater than 0.');
      return;
    }
    if (!normalizeText(avgCost)) {
      setError('Please enter avg cost per unit.');
      return;
    }
    if (!Number.isFinite(avgCostNum) || avgCostNum < 0) {
      setError('Avg cost per unit must be 0 or greater.');
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
      setError(err?.message || 'Failed to update position.');
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) return null;

  const symbol = position?.symbol ?? '';
  const name = position?.name ?? symbol;
  const isCrypto = /crypto/i.test(String(position?.category || ''));

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Edit position">
      <section className="modalCard">
        <header className="modalHeader">
          <h2>Edit {isCrypto ? 'Crypto' : 'Stock'} Position</h2>
          <button type="button" className="modalCloseBtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="modalBody">
          <label className="modalLabel">
            Asset
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
              Quantity
              <input
                type="number"
                min="0"
                step="0.00000001"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="modalInput"
              />
            </label>
            <label className="modalLabel">
              Avg cost per unit
              <input
                type="number"
                min="0"
                step="0.01"
                value={avgCost}
                onChange={(e) => setAvgCost(e.target.value)}
                className="modalInput"
              />
            </label>
          </div>

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
            disabled={isSaving || !normalizeText(qty) || !normalizeText(avgCost)}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </footer>
      </section>
    </div>
  );
}
