import { useMemo, useState } from 'react';
import { useDashboard } from '../contexts/DashboardContext.jsx';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import { formatCurrencyValue, formatMoney, formatPercent } from '../utils/formatters.js';
import './StrategySimulatorPage.css';

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
  const currentTotalValue = Number(portfolioSnapshot?.totals?.value) || 0;

  const [targetWeights, setTargetWeights] = useState({});
  const [rebalanceDirty, setRebalanceDirty] = useState(false);
  const [rebalanceMode, setRebalanceMode] = useState('constantNav');
  const [autoNormalize, setAutoNormalize] = useState(false);
  
  const [sellDownSymbol, setSellDownSymbol] = useState('');
  const [sellDownPct, setSellDownPct] = useState(20);

  const currentInputSum = useMemo(() => {
    return Object.values(targetWeights).reduce((acc, val) => acc + (Number(val) || 0), 0);
  }, [targetWeights]);

  const isValid100 = Math.abs(currentInputSum - 100) < 0.02;

  const { rebalanceRows, actionPlan, insights } = useMemo(() => {
    if (!portfolioRows.length || currentTotalValue <= 0) {
      return { rebalanceRows: [], actionPlan: [], insights: { requiredCash: 0, targetTotal: 0, turnover: 0 } };
    }

    let requiredCash = 0;
    let targetTotal = currentTotalValue;
    let turnover = 0;
    const actions = [];

    const rows = portfolioRows.map((r) => {
      const currentWeight = r.weightPct ?? 0;
      const currentVal = r.currentValue ?? 0;
      
      let targetNum = targetWeights[r.symbol] !== undefined && targetWeights[r.symbol] !== '' 
        ? Number(targetWeights[r.symbol]) 
        : null;

      if (autoNormalize && currentInputSum > 0 && targetNum != null) {
        targetNum = (targetNum / currentInputSum) * 100;
      }

      const targetVal = Number.isFinite(targetNum) && targetNum >= 0 ? (currentTotalValue * targetNum) / 100 : null;
      const w = Number.isFinite(targetNum) && targetNum >= 0 ? targetNum / 100 : null;
      
      let trade = targetVal != null ? targetVal - currentVal : null;
      let newWeight = targetVal != null && currentTotalValue > 0 ? (targetVal / currentTotalValue) * 100 : null;

      if (trade != null && rebalanceMode === 'newCashBuys' && trade > 0.01 && w != null && w > 0 && w < 0.9999) {
        const buyWithNewCash = trade / (1 - w);
        trade = buyWithNewCash;
        requiredCash += buyWithNewCash;
      }

      if (trade != null) {
        turnover += Math.abs(trade);
        if (Math.abs(trade) > 0.01) {
          actions.push({
            symbol: r.symbol,
            type: trade > 0 ? 'BUY' : 'SELL',
            amount: Math.abs(trade),
            currency: assetCurrency(r)
          });
        }
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

    if (rebalanceMode === 'newCashBuys') {
      targetTotal = currentTotalValue + requiredCash;
      rows.forEach(r => {
        if (r.newWeight != null && targetTotal > 0) {
          const simulatedEndValue = (r.currentValue ?? 0) + (r.trade ?? 0);
          r.newWeight = (simulatedEndValue / targetTotal) * 100;
        }
      });
    }

    actions.sort((a, b) => b.amount - a.amount);

    return {
      rebalanceRows: rows,
      actionPlan: actions,
      insights: {
        requiredCash,
        targetTotal,
        turnover: turnover / 2
      }
    };
  }, [portfolioRows, currentTotalValue, targetWeights, rebalanceMode, autoNormalize, currentInputSum]);


  const sellDownResult = useMemo(() => {
    if (!sellDownSymbol || !Number.isFinite(sellDownPct) || sellDownPct <= 0 || sellDownPct > 100) return null;
    const row = portfolioRows.find((r) => String(r.symbol) === String(sellDownSymbol));
    if (!row) return null;
    const value = row.currentValue ?? 0;
    const sellValue = (value * sellDownPct) / 100;
    const remaining = value - sellValue;
    const newTotal = currentTotalValue - sellValue;
    return {
      sellValue,
      remaining,
      newTotal,
      assetCurrency: assetCurrency(row),
    };
  }, [portfolioRows, sellDownSymbol, sellDownPct, currentTotalValue]);

  function handleTargetWeightChange(symbol, value) {
    setTargetWeights((prev) => ({ ...prev, [symbol]: value }));
    setRebalanceDirty(true);
  }

  function handleResetRebalance() {
    setTargetWeights({});
    setRebalanceDirty(false);
    setRebalanceMode('constantNav');
    setAutoNormalize(false);
  }

  function handleNormalizeTo100() {
    if (currentInputSum === 0) return;
    const normalized = {};
    for (const [sym, val] of Object.entries(targetWeights)) {
      if (val !== '' && Number(val) > 0) {
        normalized[sym] = ((Number(val) / currentInputSum) * 100).toFixed(2);
      }
    }
    setTargetWeights(normalized);
  }

  const lblAsset = t('portfolio.asset');
  const lblCurrentW = t('profitability.currentWeight');
  const lblTargetW = t('profitability.targetWeight');
  const lblNewW = t('profitability.newWeight');

  return (
    <section className="contentWrap strategySimulator">
      <header className="pageHeader">
        <h1>{t('strategy.title')}</h1>
      </header>

      <div className="dashboardPanel strategySimulatorPanel">
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

              <div className="strategyCardsRow">
                <button
                  type="button"
                  className={`strategyModeCard ${rebalanceMode === 'constantNav' ? 'active' : ''}`}
                  onClick={() => { setRebalanceMode('constantNav'); setRebalanceDirty(true); }}
                >
                  <h3>{t('profitability.rebalanceConstantNav')}</h3>
                  <p>{t('strategy.constantNavDesc')}</p>
                </button>
                <button
                  type="button"
                  className={`strategyModeCard ${rebalanceMode === 'newCashBuys' ? 'active' : ''}`}
                  onClick={() => { setRebalanceMode('newCashBuys'); setRebalanceDirty(true); }}
                >
                  <h3>{t('profitability.rebalanceNewCashBuys')}</h3>
                  <p>{t('strategy.newCashBuysDesc')}</p>
                </button>
              </div>

              <div className="profitabilitySellDownResult strategyKpiRow">
                <div className="profitabilityCard">
                  <span className="profitabilityCardLabel">{t('strategy.currentValue')}</span>
                  <span className="profitabilityCardValue">
                    {hideValues ? '—' : formatMoney(currentTotalValue)}
                  </span>
                </div>
                <div className="profitabilityCard">
                  <span className="profitabilityCardLabel">{t('strategy.requiredCash')}</span>
                  <span className="profitabilityCardValue">
                    {hideValues ? '—' : formatMoney(insights.requiredCash)}
                  </span>
                </div>
                <div className="profitabilityCard">
                  <span className="profitabilityCardLabel">{t('strategy.targetValue')}</span>
                  <span className="profitabilityCardValue">
                    {hideValues ? '—' : formatMoney(insights.targetTotal)}
                  </span>
                </div>
              </div>

              <div className="strategyTrackerRow">
                <div className={`strategyTotalTracker ${!isValid100 && currentInputSum > 0 && !autoNormalize ? 'warn' : 'ok'}`}>
                  <strong>{t('strategy.totalWeight')}:</strong> {autoNormalize || (isValid100 && currentInputSum > 0) ? '100.00' : currentInputSum.toFixed(2)}% / 100%
                </div>
                <div className="strategyNormControls">
                  <label className="profitabilityRadioLabel">
                    <input
                      type="checkbox"
                      checked={autoNormalize}
                      onChange={(e) => setAutoNormalize(e.target.checked)}
                    />
                    {t('strategy.autoNormalize')}
                  </label>
                  {!autoNormalize && !isValid100 && currentInputSum > 0 && (
                    <button type="button" className="btn btn-sm btn-outline" onClick={handleNormalizeTo100}>
                      {t('strategy.fixWeights')}
                    </button>
                  )}
                </div>
              </div>

              <div className="profitabilityTableWrap strategyRebalanceWrap">
                <table className="profitabilityTable strategyRebalanceTable">
                  <thead>
                    <tr>
                      <th>{lblAsset}</th>
                      <th>{lblCurrentW}</th>
                      <th>{lblTargetW}</th>
                      <th>{lblNewW}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rebalanceRows.map((r) => (
                      <tr key={r.symbol}>
                        <td data-label={lblAsset}>
                          <span className="strategyRebalanceCellVal">{r.name ?? r.symbol}</span>
                        </td>
                        <td data-label={lblCurrentW}>
                          <span className="strategyRebalanceCellVal">{formatPercent(r.currentWeight)}</span>
                        </td>
                        <td data-label={lblTargetW}>
                          <span className="strategyRebalanceCellVal strategyRebalanceTargetWrap">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.5"
                              className="profitabilityInput strategyRebalanceWeightInput"
                              value={targetWeights[r.symbol] ?? ''}
                              onChange={(e) => handleTargetWeightChange(r.symbol, e.target.value)}
                              placeholder="0"
                              aria-label={lblTargetW}
                            />
                            <span className="strategyRebalancePctSuffix">%</span>
                          </span>
                        </td>
                        <td data-label={lblNewW}>
                          <span className="strategyRebalanceCellVal">{r.newWeight != null ? formatPercent(r.newWeight) : '—'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {actionPlan.length > 0 && (
                <div className="strategyActionPlan">
                  <h3>{t('strategy.actionPlanTitle')}</h3>
                  <p>{t('strategy.actionPlanDesc', { turnover: hideValues ? '—' : formatMoney(insights.turnover) })}</p>
                  <div className="strategyActionGrid">
                    {actionPlan.map((action, idx) => (
                      <div key={idx} className={`strategyActionCard ${action.type.toLowerCase()}`}>
                        <span className="actionBadge">{action.type}</span>
                        <div className="actionDetails">
                          <span className="actionSymbol">{action.symbol}</span>
                          <span className="actionAmount">
                            {formatValInAsset(hideValues, action.amount, action.currency)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
