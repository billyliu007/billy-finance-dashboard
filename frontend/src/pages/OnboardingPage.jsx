import { useCallback, useEffect, useState } from 'react';
import { fetchJson, postJson } from '../utils/api.js';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import AddCashModal from '../components/networth/AddCashModal.jsx';
import AddCryptoPositionModal from '../components/portfolio/AddCryptoPositionModal.jsx';
import AddStockPositionModal from '../components/portfolio/AddStockPositionModal.jsx';

export default function OnboardingPage({ onCompleted }) {
  const { t } = useLanguage();
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
        if (isMounted) setError(err?.message || t('errors.failedLoadData'));
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
      setCompleteError(err?.message || t('errors.failedCompleteSetup'));
    } finally {
      setIsCompleting(false);
    }
  }

  return (
    <main className="authScreen">
      <section className="authCard wide">
        <h1>{t('onboarding.title')}</h1>
        <p>{t('onboarding.subtitle')}</p>

        {isLoading && <p>{t('app.loading')}</p>}
        {!isLoading && error && <p className="error">{error}</p>}

        {!isLoading && !error && (
          <>
            <label className="onboardingLabel">
              {t('onboarding.displayNameOptional')}
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={30}
                placeholder={t('onboarding.displayNamePlaceholder')}
              />
            </label>

            <div className="onboardingSection">
              <h3>{t('onboarding.cashDebt')}</h3>
              {cashRows.length === 0 ? (
                <p className="hint">{t('onboarding.noCashDebt')}</p>
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
                {t('onboarding.addCashDebt')}
              </button>
            </div>

            <div className="onboardingSection">
              <h3>{t('onboarding.positions')}</h3>
              {positionRows.length === 0 ? (
                <p className="hint">{t('onboarding.noPositions')}</p>
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
                  {t('onboarding.addCrypto')}
                </button>
                <button type="button" className="onboardingAddBtn" onClick={() => setIsAddStockOpen(true)}>
                  {t('onboarding.addStock')}
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
                {isCompleting ? t('onboarding.finishing') : t('onboarding.goToDashboard')}
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
