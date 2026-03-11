import { useCallback, useEffect, useState } from 'react';
import { fetchJson, postJson } from '../utils/api.js';
import AddCashModal from '../components/networth/AddCashModal.jsx';
import AddCryptoPositionModal from '../components/portfolio/AddCryptoPositionModal.jsx';
import AddStockPositionModal from '../components/portfolio/AddStockPositionModal.jsx';

export default function OnboardingPage({ onCompleted }) {
  const [displayName, setDisplayName] = useState('');
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);
  const [isAddCashOpen, setIsAddCashOpen] = useState(false);
  const [isAddCryptoOpen, setIsAddCryptoOpen] = useState(false);
  const [isAddStockOpen, setIsAddStockOpen] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completeError, setCompleteError] = useState('');

  const refresh = useCallback(() => {
    setReloadNonce((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        setError('');
        const response = await fetchJson('/api/dashboard');
        if (isMounted) setData(response);
      } catch (err) {
        if (isMounted) setError(err?.message || 'Failed to load data.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    load();
  }, [reloadNonce]);

  const cashComponents = data?.netWorth?.overview?.cashComponents ?? [];
  const cashRows = data?.netWorth?.overview?.cashRows ?? [];
  const positionRows = data?.portfolio?.tableRows ?? [];

  async function handleFinish() {
    setCompleteError('');
    setIsCompleting(true);
    try {
      await postJson('/api/onboarding/complete', {
        displayName: displayName.trim() || undefined,
      });
      onCompleted();
    } catch (err) {
      setCompleteError(err?.message || 'Failed to complete setup.');
    } finally {
      setIsCompleting(false);
    }
  }

  return (
    <main className="authScreen">
      <section className="authCard wide">
        <h1>Set up your profile</h1>
        <p>Add cash, stocks, and crypto like on Net Worth and Portfolio—or skip and add them later.</p>

        {isLoading && <p>Loading...</p>}
        {!isLoading && error && <p className="error">{error}</p>}

        {!isLoading && !error && (
          <>
            <label className="onboardingLabel">
              Display name (optional)
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={30}
                placeholder="My Worth Track User"
              />
            </label>

            <div className="onboardingSection">
              <h3>Cash / Debt</h3>
              {cashRows.length === 0 ? (
                <p className="hint">No cash or debt yet.</p>
              ) : (
                <ul className="onboardingList">
                  {cashRows.map((row) => (
                    <li key={row.id ?? row.key ?? row.instrument}>
                      {row.instrument ?? row.name ?? 'Cash'} — {row.currency} {row.amountLocal != null ? Number(row.amountLocal).toLocaleString() : ''}
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="onboardingAddBtn" onClick={() => setIsAddCashOpen(true)}>
                Add cash / debt
              </button>
            </div>

            <div className="onboardingSection">
              <h3>Positions (stocks & crypto)</h3>
              {positionRows.length === 0 ? (
                <p className="hint">No positions yet.</p>
              ) : (
                <ul className="onboardingList">
                  {positionRows.map((row) => (
                    <li key={row.symbol ?? row.name}>
                      {row.name ?? row.symbol} {row.qty != null ? ` · ${Number(row.qty)}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              <div className="onboardingAddRow">
                <button type="button" className="onboardingAddBtn" onClick={() => setIsAddCryptoOpen(true)}>
                  Add crypto
                </button>
                <button type="button" className="onboardingAddBtn" onClick={() => setIsAddStockOpen(true)}>
                  Add stock
                </button>
              </div>
            </div>

            <div className="onboardingActions">
              <button
                type="button"
                className="authBtn primary"
                onClick={handleFinish}
                disabled={isCompleting}
              >
                {isCompleting ? 'Finishing...' : 'Go to dashboard'}
              </button>
            </div>
            {completeError && <p className="error">{completeError}</p>}
          </>
        )}
      </section>

      <AddCashModal
        open={isAddCashOpen}
        onClose={() => setIsAddCashOpen(false)}
        onSaved={() => { refresh(); setIsAddCashOpen(false); }}
        existingComponents={cashComponents}
      />
      <AddCryptoPositionModal
        open={isAddCryptoOpen}
        onClose={() => setIsAddCryptoOpen(false)}
        onSaved={() => { refresh(); setIsAddCryptoOpen(false); }}
      />
      <AddStockPositionModal
        open={isAddStockOpen}
        onClose={() => setIsAddStockOpen(false)}
        onSaved={() => { refresh(); setIsAddStockOpen(false); }}
      />
    </main>
  );
}
