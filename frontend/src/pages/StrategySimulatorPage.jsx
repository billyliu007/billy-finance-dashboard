import { useMemo, useState } from 'react';
import { useDashboard } from '../contexts/DashboardContext.jsx';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import { formatCurrencyValue, formatMoney, formatPercent } from '../utils/formatters.js';

function assetCurrency(row) {
  return String(row?.currency || 'USD').trim().toUpperCase() || 'USD';
}

function formatValInAsset(hideValues, value, currency) {
  if (hideValues) return '—';
  return formatCurrencyValue(value, currency);
}

export default function StrategySimulatorPage({ hideValues }) {
  const { t } = useLanguage();
  const { portfolio: portfolioSnapshot, isLoading, error } = useDashboard();
  const portfolioRows = useMemo(() => portfolioSnapshot?.tableRows ?? [], [portfolioSnapshot]);
  const hasHoldings = Boolean(portfolioSnapshot && !portfolioSnapshot.isEmpty);
  const totalValue = Number(portfolioSnapshot?.totals?.value) || 0;

  const [targetWeights, setTargetWeights] = useState({});
  const [rebalanceDirty, setRebalanceDirty] = useState(false);
  /** constantNav: total portfolio value unchanged (reshuffle). newCashBuys: buys funded with new cash so total NAV increases. */
  const [rebalanceMode, setRebalanceMode] = useState('constantNav');
  const [sellDownSymbol, setSellDownSymbol] = useState('');
  const [sellDownPct, setSellDownPct] = useState(20);

  const rebalanceRows = useMemo(() => {
    if (!portfolioRows.length || totalValue <= 0) return [];
    return portfolioRows.map((r) => {
      const currentWeight = r.weightPct ?? 0;
      const currentVal = r.currentValue ?? 0;
      const targetPct = targetWeights[r.symbol];
      const targetNum = targetPct != null && targetPct !== '' ? Number(targetPct) : null;
      const targetVal = Number.isFinite(targetNum) && targetNum >= 0 ? (totalValue * targetNum) / 100 : null;
      const w = Number.isFinite(targetNum) && targetNum >= 0 ? targetNum / 100 : null;
      let trade = targetVal != null ? targetVal - currentVal : null;
      let newWeight = targetVal != null && totalValue > 0 ? (targetVal / totalValue) * 100 : null;

      if (
        trade != null &&
        rebalanceMode === 'newCashBuys' &&
        trade > 0.01 &&
        w != null &&
        w > 0 &&
        w < 0.9999
      ) {
        const buyWithNewCash = trade / (1 - w);
        trade = buyWithNewCash;
        const newTotal = totalValue + buyWithNewCash;
        newWeight = newTotal > 0 ? ((currentVal + buyWithNewCash) / newTotal) * 100 : newWeight;
      }

      return {
        ...r,
        currentWeight,
        targetPct: targetNum,
        targetVal,
        trade,
        newWeight,
      };
    });
  }, [portfolioRows, totalValue, targetWeights, rebalanceMode]);

  const sellDownResult = useMemo(() => {
    if (!sellDownSymbol || !Number.isFinite(sellDownPct) || sellDownPct <= 0 || sellDownPct > 100) return null;
    const row = portfolioRows.find((r) => String(r.symbol) === String(sellDownSymbol));
    if (!row) return null;
    const value = row.currentValue ?? 0;
    const sellValue = (value * sellDownPct) / 100;
    const remaining = value - sellValue;
    const newTotal = totalValue - sellValue;
    return {
      sellValue,
      remaining,
      newTotal,
      assetCurrency: assetCurrency(row),
    };
  }, [portfolioRows, sellDownSymbol, sellDownPct, totalValue]);

  function handleTargetWeightChange(symbol, value) {
    setTargetWeights((prev) => ({ ...prev, [symbol]: value }));
    setRebalanceDirty(true);
  }

  function handleResetRebalance() {
    setTargetWeights({});
    setRebalanceDirty(false);
    setRebalanceMode('constantNav');
  }

  return (
    <section className="contentWrap">
      <header className="pageHeader">
        <h1>{t('strategy.title')}</h1>
      </header>

      <div className="dashboardPanel">
        {isLoading && <p>{t('app.loadingDashboard')}</p>}
        {!isLoading && error && <p className="error">{error}</p>}
        {!isLoading && !error && !hasHoldings && (
          <p>{t('profitability.noHoldings')}</p>
        )}

        {!isLoading && !error && hasHoldings && (
          <>
            <section className="profitabilitySection">
              <h2 className="profitabilitySectionTitle">{t('profitability.rebalance')}</h2>
              <p className="profitabilitySectionDesc">{t('profitability.rebalanceDesc')}</p>
              <div className="profitabilityRebalanceMode" role="group" aria-label={t('profitability.rebalanceMethod')}>
                <span className="profitabilityLabel">{t('profitability.rebalanceMethod')}</span>
                <label className="profitabilityRadioLabel">
                  <input
                    type="radio"
                    name="rebalanceMode"
                    checked={rebalanceMode === 'constantNav'}
                    onChange={() => {
                      setRebalanceMode('constantNav');
                      setRebalanceDirty(true);
                    }}
                  />
                  {t('profitability.rebalanceConstantNav')}
                </label>
                <label className="profitabilityRadioLabel">
                  <input
                    type="radio"
                    name="rebalanceMode"
                    checked={rebalanceMode === 'newCashBuys'}
                    onChange={() => {
                      setRebalanceMode('newCashBuys');
                      setRebalanceDirty(true);
                    }}
                  />
                  {t('profitability.rebalanceNewCashBuys')}
                </label>
              </div>
              <p className="hint profitabilityRebalanceHint">{t('profitability.rebalanceMethodHint')}</p>
              <div className="profitabilityTableWrap">
                <table className="profitabilityTable profitabilityTable--rebalance">
                  <thead>
                    <tr>
                      <th>{t('portfolio.asset')}</th>
                      <th>{t('profitability.currentWeight')}</th>
                      <th>{t('profitability.targetWeight')}</th>
                      <th>{t('profitability.suggestedTrade')}</th>
                      <th>{t('profitability.newWeight')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rebalanceRows.map((r) => (
                      <tr key={r.symbol}>
                        <td>{r.name ?? r.symbol}</td>
                        <td>{formatPercent(r.currentWeight)}</td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.5"
                            className="profitabilityInput"
                            value={targetWeights[r.symbol] ?? ''}
                            onChange={(e) => handleTargetWeightChange(r.symbol, e.target.value)}
                            placeholder="0"
                          />
                          %
                        </td>
                        <td>
                          {r.trade != null && (
                            r.trade < -0.01
                              ? `${t('profitability.sellAmount')} ${formatValInAsset(hideValues, -r.trade, assetCurrency(r))}`
                              : r.trade > 0.01
                                ? `${t('profitability.buyAmount')} ${formatValInAsset(hideValues, r.trade, assetCurrency(r))}`
                                : '—'
                          )}
                        </td>
                        <td>{r.newWeight != null ? formatPercent(r.newWeight) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rebalanceDirty && (
                <button type="button" className="modalBtn secondary profitabilityResetBtn" onClick={handleResetRebalance}>
                  {t('profitability.reset')}
                </button>
              )}
            </section>

            <section className="profitabilitySection">
              <h2 className="profitabilitySectionTitle">{t('profitability.sellDown')}</h2>
              <p className="profitabilitySectionDesc">{t('profitability.sellDownDesc')}</p>
              <div className="profitabilitySellDownRow">
                <label>
                  <span className="profitabilityLabel">{t('profitability.selectHolding')}</span>
                  <select
                    className="profitabilitySelect"
                    value={sellDownSymbol}
                    onChange={(e) => setSellDownSymbol(e.target.value)}
                  >
                    <option value="">—</option>
                    {portfolioRows.map((r) => (
                      <option key={r.symbol} value={r.symbol}>{r.name ?? r.symbol}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="profitabilityLabel">{t('profitability.sellPct')}</span>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    step="5"
                    className="profitabilityInput"
                    value={sellDownPct}
                    onChange={(e) => setSellDownPct(Number(e.target.value) || 0)}
                  />
                </label>
              </div>
              {sellDownResult && (
                <div className="profitabilitySellDownResult">
                  <div className="profitabilityCard">
                    <span className="profitabilityCardLabel">{t('profitability.cashReceived')}</span>
                    <span className="profitabilityCardValue">
                      {formatValInAsset(hideValues, sellDownResult.sellValue, sellDownResult.assetCurrency)}
                    </span>
                  </div>
                  <div className="profitabilityCard">
                    <span className="profitabilityCardLabel">{t('profitability.remainingValue')}</span>
                    <span className="profitabilityCardValue">
                      {formatValInAsset(hideValues, sellDownResult.remaining, sellDownResult.assetCurrency)}
                    </span>
                  </div>
                  <div className="profitabilityCard">
                    <span className="profitabilityCardLabel">{t('profitability.newTotalValue')}</span>
                    <span className="profitabilityCardValue">
                      {hideValues ? '—' : formatMoney(sellDownResult.newTotal)}
                    </span>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}
