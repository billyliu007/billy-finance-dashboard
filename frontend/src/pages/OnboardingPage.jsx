import { useState } from 'react';
import { postJson } from '../utils/api.js';

const DEFAULT_CASH_ROWS = [
  { name: 'SGD Cash', currency: 'SGD', balance: '' },
  { name: 'USD Cash', currency: 'USD', balance: '' },
  { name: 'CNY Debt', currency: 'CNY', balance: '' },
];

const DEFAULT_ASSET_ROWS = [
  { symbol: 'BTC', name: 'BTC', category: 'Crypto Assets', qty: '', purchasePrice: '' },
  { symbol: 'ETH', name: 'ETH', category: 'Crypto Assets', qty: '', purchasePrice: '' },
  { symbol: 'QQQ', name: 'QQQ', category: 'Stock Assets', qty: '', purchasePrice: '' },
  { symbol: 'QQQM', name: 'QQQM', category: 'Stock Assets', qty: '', purchasePrice: '' },
  { symbol: 'TSLA', name: 'TSLA', category: 'Stock Assets', qty: '', purchasePrice: '' },
];

export default function OnboardingPage({ onCompleted }) {
  const [displayName, setDisplayName] = useState('');
  const [cashComponents, setCashComponents] = useState(DEFAULT_CASH_ROWS);
  const [positions, setPositions] = useState(DEFAULT_ASSET_ROWS);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  function updateCashRow(index, key, value) {
    setCashComponents((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  }

  function updatePositionRow(index, key, value) {
    setPositions((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError('');
    try {
      await postJson('/api/onboarding/initialize', {
        displayName,
        cashComponents: cashComponents.map((item) => ({
          name: item.name,
          currency: item.currency,
          balance: Number(item.balance ?? 0),
        })),
        positions: positions.map((item) => ({
          ...item,
          qty: Number(item.qty || 0),
          purchasePrice: Number(item.purchasePrice || 0),
        })),
      });
      onCompleted();
    } catch (err) {
      setError(err?.message || 'Failed to save onboarding data.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="authScreen">
      <section className="authCard wide">
        <h1>Set up your profile</h1>
        <p>Complete this one-time setup with your initial cash, debt, and asset positions.</p>
        <form className="onboardingForm" onSubmit={handleSubmit}>
          <label>
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              minLength={2}
              maxLength={30}
              placeholder="My Worth Track User"
            />
          </label>
          <div>
            <h3>Cash / Debt</h3>
            <p className="hint">Use negative balance for debt (e.g. -5000).</p>
            <div className="onboardingGrid">
              {cashComponents.map((row, index) => (
                <div className="onboardingRow" key={`${row.currency}-${row.name}-${index}`}>
                  <input value={row.name} onChange={(e) => updateCashRow(index, 'name', e.target.value)} placeholder="Name" required />
                  <input value={row.currency} onChange={(e) => updateCashRow(index, 'currency', e.target.value.toUpperCase())} placeholder="Currency" required />
                  <input type="number" step="0.01" value={row.balance} onChange={(e) => updateCashRow(index, 'balance', e.target.value)} placeholder="Balance (negative = debt)" required />
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3>Assets</h3>
            <div className="onboardingGrid">
              {positions.map((row, index) => (
                <div className="onboardingRow" key={row.symbol}>
                  <input value={row.symbol} onChange={(event) => updatePositionRow(index, 'symbol', event.target.value.toUpperCase())} placeholder="Symbol" required />
                  <select value={row.category} onChange={(event) => updatePositionRow(index, 'category', event.target.value)}>
                    <option value="Crypto Assets">Crypto Assets</option>
                    <option value="Stock Assets">Stock Assets</option>
                  </select>
                  <input type="number" step="0.00000001" value={row.qty} onChange={(event) => updatePositionRow(index, 'qty', event.target.value)} placeholder="Quantity" required />
                  <input type="number" step="0.01" value={row.purchasePrice} onChange={(event) => updatePositionRow(index, 'purchasePrice', event.target.value)} placeholder="Purchase price (USD)" required />
                </div>
              ))}
            </div>
          </div>
          <button type="submit" disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Finish Setup'}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
