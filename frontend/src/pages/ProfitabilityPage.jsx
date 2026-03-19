import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useDashboard } from '../contexts/DashboardContext.jsx';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import useApiData from '../hooks/useApiData.js';
import { formatMoney, formatPercent } from '../utils/formatters.js';

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function startOfYearDateOnly() {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
}

function addDaysDateOnly(dateOnly, deltaDays) {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function subtractMonthsDateOnly(dateOnly, months) {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function formatVal(hideValues, v) {
  if (hideValues) return '—';
  return formatMoney(v);
}

function formatPct(hideValues, v) {
  if (hideValues) return '—';
  return formatPercent(v);
}

export default function ProfitabilityPage({ hideValues }) {
  const { t } = useLanguage();
  const { portfolio: portfolioSnapshot, benchmarks: benchmarksObj, isLoading: isDashboardLoading, error: dashboardError } = useDashboard();

  const [timeframe, setTimeframe] = useState('since'); // since | ytd | 1m | 3m | 1y | custom
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const range = useMemo(() => {
    const today = todayDateOnly();
    if (timeframe === 'ytd') return { from: startOfYearDateOnly(), to: today };
    if (timeframe === '1m') return { from: subtractMonthsDateOnly(today, 1), to: today };
    if (timeframe === '3m') return { from: subtractMonthsDateOnly(today, 3), to: today };
    if (timeframe === '1y') return { from: subtractMonthsDateOnly(today, 12), to: today };
    if (timeframe === 'custom') return { from: customFrom || null, to: customTo || null };
    return { from: null, to: null };
  }, [timeframe, customFrom, customTo]);

  const profitabilityPath = useMemo(() => {
    const params = new URLSearchParams();
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return `/api/profitability${qs}`;
  }, [range.from, range.to]);

  const { data: analytics, isLoading: isAnalyticsLoading, error: analyticsError } = useApiData(profitabilityPath);

  const portfolioRows = useMemo(() => portfolioSnapshot?.tableRows ?? [], [portfolioSnapshot]);
  const hasHoldings = Boolean(portfolioSnapshot && !portfolioSnapshot.isEmpty);
  const summary = analytics?.summary ?? null;
  const monthlyStacked = analytics?.timeSeries?.monthlyStacked ?? [];
  const realizedMonthly = analytics?.timeSeries?.realizedMonthly ?? [];
  const attribution = analytics?.attribution ?? null;
  const trades = analytics?.trades ?? null;
  const insights = analytics?.insights ?? [];

  const [targetWeights, setTargetWeights] = useState({});
  const [rebalanceDirty, setRebalanceDirty] = useState(false);
  const [sellDownSymbol, setSellDownSymbol] = useState('');
  const [sellDownPct, setSellDownPct] = useState(20);

  const totalValue = Number(portfolioSnapshot?.totals?.value) || 0;

  const rebalanceRows = useMemo(() => {
    if (!portfolioRows.length || totalValue <= 0) return [];
    return portfolioRows.map((r) => {
      const currentWeight = r.weightPct ?? 0;
      const currentVal = r.currentValue ?? 0;
      const targetPct = targetWeights[r.symbol];
      const targetNum = targetPct != null && targetPct !== '' ? Number(targetPct) : null;
      const targetVal = Number.isFinite(targetNum) && targetNum >= 0 ? (totalValue * targetNum) / 100 : null;
      const trade = targetVal != null ? targetVal - currentVal : null;
      const newWeight = targetVal != null && totalValue > 0 ? (targetVal / totalValue) * 100 : null;
      return {
        ...r,
        currentWeight,
        targetPct: targetNum,
        targetVal,
        trade,
        newWeight,
      };
    });
  }, [portfolioRows, totalValue, targetWeights]);

  const sellDownResult = useMemo(() => {
    if (!sellDownSymbol || !Number.isFinite(sellDownPct) || sellDownPct <= 0 || sellDownPct > 100) return null;
    const row = portfolioRows.find((r) => String(r.symbol) === String(sellDownSymbol));
    if (!row) return null;
    const value = row.currentValue ?? 0;
    const sellValue = (value * sellDownPct) / 100;
    const remaining = value - sellValue;
    const newTotal = totalValue - sellValue;
    return { sellValue, remaining, newTotal, name: row.name };
  }, [portfolioRows, sellDownSymbol, sellDownPct, totalValue]);

  function handleTargetWeightChange(symbol, value) {
    setTargetWeights((prev) => ({ ...prev, [symbol]: value }));
    setRebalanceDirty(true);
  }

  function handleResetRebalance() {
    setTargetWeights({});
    setRebalanceDirty(false);
  }

  return (
    <section className="contentWrap">
      <header className="pageHeader">
        <h1>{t('profitability.title')}</h1>
      </header>

      <div className="dashboardPanel">
        {(isDashboardLoading || isAnalyticsLoading) && <p>{t('app.loadingDashboard')}</p>}
        {!isDashboardLoading && dashboardError && <p className="error">{dashboardError}</p>}
        {!isAnalyticsLoading && analyticsError && <p className="error">{analyticsError}</p>}

        <section className="profitabilitySection">
          <h2 className="profitabilitySectionTitle">{t('profitability.timeframe')}</h2>
          <div className="profitabilitySellDownRow">
            <label>
              <span className="profitabilityLabel">{t('profitability.timeframe')}</span>
              <select className="profitabilitySelect" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                <option value="since">{t('profitability.sinceInception')}</option>
                <option value="ytd">{t('profitability.ytd')}</option>
                <option value="1m">{t('profitability.oneMonth')}</option>
                <option value="3m">{t('profitability.threeMonths')}</option>
                <option value="1y">{t('profitability.oneYear')}</option>
                <option value="custom">{t('profitability.custom')}</option>
              </select>
            </label>
            {timeframe === 'custom' && (
              <>
                <label>
                  <span className="profitabilityLabel">{t('profitability.from')}</span>
                  <input className="profitabilityInput" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                </label>
                <label>
                  <span className="profitabilityLabel">{t('profitability.to')}</span>
                  <input className="profitabilityInput" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                </label>
              </>
            )}
          </div>
        </section>

        {!isDashboardLoading && !dashboardError && !hasHoldings && (
          <p>{t('profitability.noHoldings')}</p>
        )}

        {!isDashboardLoading && !dashboardError && hasHoldings && summary && (
          <>
            <section className="profitabilitySection">
              <h2 className="profitabilitySectionTitle">{t('profitability.yourPortfolio')}</h2>
              <div className="profitabilityCards">
                <div className="profitabilityCard">
                  <span className="profitabilityCardLabel">{t('profitability.totalReturn')}</span>
                  <span className={`profitabilityCardValue ${Number(summary.totalReturn?.value) >= 0 ? 'pos' : 'neg'}`}>
                    {formatVal(hideValues, summary.totalReturn?.value)}
                  </span>
                  <span className={`profitabilityCardSub ${Number(summary.totalReturn?.pct) >= 0 ? 'pos' : 'neg'}`}>
                    {formatPct(hideValues, summary.totalReturn?.pct ?? 0)}
                  </span>
                </div>
                <div className="profitabilityCard">
                  <span className="profitabilityCardLabel">{t('profitability.realizedPl')}</span>
                  <span className={`profitabilityCardValue ${Number(summary.realized?.pnl) >= 0 ? 'pos' : 'neg'}`}>
                    {formatVal(hideValues, summary.realized?.pnl)}
                  </span>
                </div>
                <div className="profitabilityCard">
                  <span className="profitabilityCardLabel">{t('profitability.unrealizedPl')}</span>
                  <span className={`profitabilityCardValue ${Number(summary.unrealized?.pnl) >= 0 ? 'pos' : 'neg'}`}>
                    {formatVal(hideValues, summary.unrealized?.pnl)}
                  </span>
                </div>
                <div className="profitabilityCard">
                  <span className="profitabilityCardLabel">{t('profitability.winRate')}</span>
                  <span className="profitabilityCardValue">{hideValues ? '—' : formatPercent(summary.winStats?.winRate ?? 0)}</span>
                </div>
                <div className="profitabilityCard">
                  <span className="profitabilityCardLabel">{t('profitability.profitFactor')}</span>
                  <span className="profitabilityCardValue">
                    {hideValues ? '—' : (summary.winStats?.profitFactor == null ? '—' : Number(summary.winStats.profitFactor).toFixed(2))}
                  </span>
                </div>
                <div className="profitabilityCard">
                  <span className="profitabilityCardLabel">{t('profitability.largestDrawdown')}</span>
                  <span className="profitabilityCardValue">
                    {hideValues ? '—' : (summary.risk?.maxDrawdownPct == null ? '—' : formatPercent(summary.risk.maxDrawdownPct))}
                  </span>
                </div>
              </div>
            </section>

            {/* Benchmark comparison */}
            <section className="profitabilitySection">
              <h2 className="profitabilitySectionTitle">{t('profitability.benchmarkComparison')}</h2>
              <p className="profitabilitySectionDesc">{t('profitability.vsSpyBtc')}</p>
              <div className="profitabilityCards profitabilityBenchmarkCards">
                {benchmarksObj?.spy && (
                  <div className="profitabilityCard">
                    <span className="profitabilityCardLabel">{t('profitability.spy')}</span>
                    <span className="profitabilityCardValue">{formatVal(hideValues, benchmarksObj.spy.price)}</span>
                    {benchmarksObj.spy.changePct != null && (
                      <span className={`profitabilityCardSub ${benchmarksObj.spy.changePct >= 0 ? 'pos' : 'neg'}`}>
                        {t('profitability.dailyChange')}: {formatPercent(benchmarksObj.spy.changePct)}
                      </span>
                    )}
                  </div>
                )}
                {benchmarksObj?.btc && (
                  <div className="profitabilityCard">
                    <span className="profitabilityCardLabel">{t('profitability.btc')}</span>
                    <span className="profitabilityCardValue">{formatVal(hideValues, benchmarksObj.btc.price)}</span>
                    {benchmarksObj.btc.changePct != null && (
                      <span className={`profitabilityCardSub ${benchmarksObj.btc.changePct >= 0 ? 'pos' : 'neg'}`}>
                        {t('profitability.dailyChange')}: {formatPercent(benchmarksObj.btc.changePct)}
                      </span>
                    )}
                  </div>
                )}
                {!benchmarksObj?.spy && !benchmarksObj?.btc && (
                  <p className="profitabilityNoBenchmarks">{t('app.loading')}</p>
                )}
              </div>
            </section>

            {/* Performance over time */}
            <section className="profitabilitySection">
              <h2 className="profitabilitySectionTitle">{t('profitability.performanceOverTime')}</h2>
              <p className="profitabilitySectionDesc">{t('profitability.stackedBarsTitle')}</p>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={monthlyStacked}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                    <XAxis dataKey="month" tick={{ fill: 'rgba(226,232,240,0.8)', fontSize: 12 }} />
                    <YAxis tick={{ fill: 'rgba(226,232,240,0.8)', fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="realizedPnl" stackId="pnl" name={t('profitability.realizedPl')} fill="#34d399" />
                    <Bar dataKey="unrealizedPnlEst" stackId="pnl" name={t('profitability.unrealizedPl')} fill="#60a5fa" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <p className="profitabilitySectionDesc">{t('profitability.cumulativeRealized')}</p>
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <LineChart data={monthlyStacked}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                    <XAxis dataKey="month" tick={{ fill: 'rgba(226,232,240,0.8)', fontSize: 12 }} />
                    <YAxis tick={{ fill: 'rgba(226,232,240,0.8)', fontSize: 12 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="cumulativeRealized" name={t('profitability.cumulativeRealized')} stroke="#f59e0b" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Attribution */}
            <section className="profitabilitySection">
              <h2 className="profitabilitySectionTitle">{t('profitability.attribution')}</h2>
              <div className="profitabilityTableWrap">
                <table className="profitabilityTable">
                  <thead>
                    <tr>
                      <th>{t('profitability.byAssetClass')}</th>
                      <th>{t('profitability.realizedPl')}</th>
                      <th>{t('profitability.unrealizedPl')}</th>
                      <th>{t('profitability.pl')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(attribution?.byAssetClass ?? []).map((r) => (
                      <tr key={r.key}>
                        <td>{r.key}</td>
                        <td className={r.realizedPnl >= 0 ? 'pos' : 'neg'}>{formatVal(hideValues, r.realizedPnl)}</td>
                        <td className={r.unrealizedPnl >= 0 ? 'pos' : 'neg'}>{formatVal(hideValues, r.unrealizedPnl)}</td>
                        <td className={r.totalPnl >= 0 ? 'pos' : 'neg'}>{formatVal(hideValues, r.totalPnl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="profitabilityTableWrap">
                <table className="profitabilityTable">
                  <thead>
                    <tr>
                      <th>{t('profitability.contributors')}</th>
                      <th>{t('profitability.pl')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(attribution?.topContributors ?? []).map((r) => (
                      <tr key={`c-${r.symbol}`}>
                        <td>{r.name} ({r.symbol})</td>
                        <td className={r.totalPnl >= 0 ? 'pos' : 'neg'}>{formatVal(hideValues, r.totalPnl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="profitabilityTableWrap">
                <table className="profitabilityTable">
                  <thead>
                    <tr>
                      <th>{t('profitability.detractors')}</th>
                      <th>{t('profitability.pl')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(attribution?.topDetractors ?? []).map((r) => (
                      <tr key={`d-${r.symbol}`}>
                        <td>{r.name} ({r.symbol})</td>
                        <td className={r.totalPnl >= 0 ? 'pos' : 'neg'}>{formatVal(hideValues, r.totalPnl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Trade analytics */}
            <section className="profitabilitySection">
              <h2 className="profitabilitySectionTitle">{t('profitability.tradeAnalytics')}</h2>

              <p className="profitabilitySectionDesc">{t('profitability.tradeReturnDistribution')}</p>
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={trades?.distributions?.tradeReturnHistogram ?? []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                    <XAxis dataKey="bucket" tick={{ fill: 'rgba(226,232,240,0.8)', fontSize: 11 }} interval={2} />
                    <YAxis tick={{ fill: 'rgba(226,232,240,0.8)', fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" name="count" fill="#a78bfa" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <p className="profitabilitySectionDesc">{t('profitability.holdingPeriodDistribution')}</p>
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer>
                  <BarChart data={trades?.distributions?.holdingPeriodHistogram ?? []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                    <XAxis dataKey="bucket" tick={{ fill: 'rgba(226,232,240,0.8)', fontSize: 12 }} />
                    <YAxis tick={{ fill: 'rgba(226,232,240,0.8)', fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" name="count" fill="#22d3ee" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="profitabilityTableWrap">
                <table className="profitabilityTable">
                  <thead>
                    <tr>
                      <th colSpan={7}>{t('profitability.bestTrades')}</th>
                    </tr>
                    <tr>
                      <th>{t('profitability.date')}</th>
                      <th>{t('portfolio.asset')}</th>
                      <th>{t('profitability.qty')}</th>
                      <th>{t('profitability.proceeds')}</th>
                      <th>{t('profitability.cost')}</th>
                      <th>{t('profitability.pl')}</th>
                      <th>{t('profitability.returnPctShort')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(trades?.best ?? []).map((tr) => (
                      <tr key={`best-${tr.id}`}>
                        <td>{tr.txDate}</td>
                        <td>{tr.symbol}</td>
                        <td>{hideValues ? '—' : tr.qty}</td>
                        <td>{formatVal(hideValues, tr.proceeds)}</td>
                        <td>{formatVal(hideValues, tr.cost)}</td>
                        <td className={tr.pnl >= 0 ? 'pos' : 'neg'}>{formatVal(hideValues, tr.pnl)}</td>
                        <td>{hideValues ? '—' : (tr.returnPct == null ? '—' : formatPercent(tr.returnPct))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="profitabilityTableWrap">
                <table className="profitabilityTable">
                  <thead>
                    <tr>
                      <th colSpan={7}>{t('profitability.worstTrades')}</th>
                    </tr>
                    <tr>
                      <th>{t('profitability.date')}</th>
                      <th>{t('portfolio.asset')}</th>
                      <th>{t('profitability.qty')}</th>
                      <th>{t('profitability.proceeds')}</th>
                      <th>{t('profitability.cost')}</th>
                      <th>{t('profitability.pl')}</th>
                      <th>{t('profitability.returnPctShort')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(trades?.worst ?? []).map((tr) => (
                      <tr key={`worst-${tr.id}`}>
                        <td>{tr.txDate}</td>
                        <td>{tr.symbol}</td>
                        <td>{hideValues ? '—' : tr.qty}</td>
                        <td>{formatVal(hideValues, tr.proceeds)}</td>
                        <td>{formatVal(hideValues, tr.cost)}</td>
                        <td className={tr.pnl >= 0 ? 'pos' : 'neg'}>{formatVal(hideValues, tr.pnl)}</td>
                        <td>{hideValues ? '—' : (tr.returnPct == null ? '—' : formatPercent(tr.returnPct))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Insights */}
            <section className="profitabilitySection">
              <h2 className="profitabilitySectionTitle">{t('profitability.actionableInsights')}</h2>
              <ul className="profitabilityInsights">
                {(insights || []).map((i) => (
                  <li key={i.key}>{i.message}</li>
                ))}
              </ul>
            </section>

            {/* What-if: Rebalance */}
            <section className="profitabilitySection">
              <h2 className="profitabilitySectionTitle">{t('profitability.rebalance')}</h2>
              <p className="profitabilitySectionDesc">{t('profitability.rebalanceDesc')}</p>
              <div className="profitabilityTableWrap">
                <table className="profitabilityTable">
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
                              ? `${t('profitability.sellAmount')} ${formatVal(-r.trade)}`
                              : r.trade > 0.01
                                ? `${t('profitability.buyAmount')} ${formatVal(r.trade)}`
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

            {/* What-if: Sell-down */}
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
                    <span className="profitabilityCardValue">{formatVal(sellDownResult.sellValue)}</span>
                  </div>
                  <div className="profitabilityCard">
                    <span className="profitabilityCardLabel">{t('profitability.remainingValue')}</span>
                    <span className="profitabilityCardValue">{formatVal(sellDownResult.remaining)}</span>
                  </div>
                  <div className="profitabilityCard">
                    <span className="profitabilityCardLabel">{t('profitability.newTotalValue')}</span>
                    <span className="profitabilityCardValue">{formatVal(sellDownResult.newTotal)}</span>
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
