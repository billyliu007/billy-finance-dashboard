import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Rectangle,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useDashboard } from '../contexts/DashboardContext.jsx';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import useApiData from '../hooks/useApiData.js';
import { formatCurrencyValue, formatMoney, formatPercent } from '../utils/formatters.js';

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function startOfYearDateOnly() {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
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

function formatValByCurrency(hideValues, v, currency) {
  if (hideValues) return '—';
  return formatCurrencyValue(Number(v) || 0, currency || 'USD');
}

function ActiveAttributionBar(props) {
  const {
    x,
    y,
    width,
    height,
    fill,
  } = props;
  return (
    <Rectangle
      x={x}
      y={y}
      width={width}
      height={height}
      radius={4}
      fill={fill}
      stroke="#67e8f9"
      strokeWidth={2}
      style={{ filter: 'drop-shadow(0 0 8px rgba(56,189,248,0.45))' }}
    />
  );
}

const CHART_GRID_STROKE = '#334155';
const CHART_AXIS_TICK = { fill: '#94a3b8', fontSize: 12 };
const CHART_TOOLTIP_STYLE = {
  backgroundColor: '#0b1220',
  border: '1px solid #334155',
  borderRadius: '10px',
  color: '#e2e8f0',
};
const POS_BAR = '#22c55e';
const NEG_BAR = '#fb7185';

export default function ProfitabilityPage({ hideValues }) {
  const { t } = useLanguage();
  const { portfolio: portfolioSnapshot, isLoading: isDashboardLoading, error: dashboardError } = useDashboard();

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

  const tradingPerformancePath = useMemo(() => {
    const params = new URLSearchParams();
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return `/api/trading-performance${qs}`;
  }, [range.from, range.to]);

  const { data: analytics, isLoading: isAnalyticsLoading, error: analyticsError } = useApiData(tradingPerformancePath);

  const hasHoldings = Boolean(portfolioSnapshot && !portfolioSnapshot.isEmpty);
  const summary = analytics?.summary ?? null;
  const monthlyStacked = analytics?.timeSeries?.monthlyStacked ?? [];
  const realizedAttribution = analytics?.realizedAttribution ?? null;
  const trades = analytics?.trades ?? null;
  const tradeReturnHistogram = useMemo(() => {
    const raw = trades?.distributions?.tradeReturnHistogram ?? [];
    if (!Array.isArray(raw) || raw.length === 0) return [];
    const first = raw.findIndex((b) => Number(b?.count) > 0);
    if (first < 0) return [];
    let last = -1;
    for (let i = raw.length - 1; i >= 0; i -= 1) {
      if (Number(raw[i]?.count) > 0) {
        last = i;
        break;
      }
    }
    return raw.slice(first, last + 1);
  }, [trades]);

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
          <div className="profitabilityControlRow profitabilitySellDownRow">
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
                  <span className="profitabilityCardLabel">{t('profitability.realizedPl')}</span>
                      <span className={`profitabilityCardValue ${Number(summary.realized?.pnl) >= 0 ? 'pos' : 'neg'}`}>
                    {formatVal(hideValues, summary.realized?.pnl)}
                  </span>
                      <span className={`profitabilityCardSub ${Number(summary.realized?.pnl) >= 0 ? 'pos' : 'neg'}`}>
                        {hideValues ? '—' : formatPercent(summary.realized?.pct ?? 0)}
                      </span>
                </div>
                <div className="profitabilityCard">
                  <span className="profitabilityCardLabel">{t('profitability.winRate')}</span>
                  <span className="profitabilityValueWithInfo">
                    <span className="profitabilityCardValue">{hideValues ? '—' : formatPercent(summary.winStats?.winRate ?? 0)}</span>
                    <span className="profitabilityInfoWrap">
                      <button
                        type="button"
                        className="profitabilityInfoDot"
                        aria-label={t('profitability.winRateHelp')}
                      >
                        ⓘ
                      </button>
                      <span className="profitabilityTooltip" role="tooltip">
                        {t('profitability.winRateHelp')}
                      </span>
                    </span>
                  </span>
                </div>
                <div className="profitabilityCard">
                  <span className="profitabilityCardLabel">{t('profitability.profitFactor')}</span>
                  <span className="profitabilityValueWithInfo">
                    <span className="profitabilityCardValue">
                      {hideValues ? '—' : (summary.winStats?.profitFactor == null ? '—' : Number(summary.winStats.profitFactor).toFixed(2))}
                    </span>
                    <span className="profitabilityInfoWrap">
                      <button
                        type="button"
                        className="profitabilityInfoDot"
                        aria-label={t('profitability.profitFactorHelp')}
                      >
                        ⓘ
                      </button>
                      <span className="profitabilityTooltip" role="tooltip">
                        {t('profitability.profitFactorHelp')}
                      </span>
                    </span>
                  </span>
                </div>
                <div className="profitabilityCard">
                  <span className="profitabilityCardLabel">{t('profitability.avgWin')}</span>
                  <span className={`profitabilityCardValue ${Number(summary.winStats?.avgWin) >= 0 ? 'pos' : 'neg'}`}>
                    {formatVal(hideValues, summary.winStats?.avgWin)}
                  </span>
                </div>
                <div className="profitabilityCard">
                  <span className="profitabilityCardLabel">{t('profitability.avgLoss')}</span>
                  <span className={`profitabilityCardValue ${Number(summary.winStats?.avgLoss) >= 0 ? 'pos' : 'neg'}`}>
                    {formatVal(hideValues, summary.winStats?.avgLoss)}
                  </span>
                </div>
              </div>
            </section>

            {/* Performance over time */}
            <section className="profitabilitySection">
              <h2 className="profitabilitySectionTitle">{t('profitability.performanceOverTime')}</h2>
              <p className="profitabilitySectionDesc">{t('profitability.cumulativeRealized')}</p>
              <div className="profitabilityChartArea profitabilityChartArea--md">
                <ResponsiveContainer>
                  <LineChart data={monthlyStacked}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                    <XAxis dataKey="month" tick={{ fill: 'rgba(226,232,240,0.8)', fontSize: 12 }} />
                    <YAxis tick={{ fill: 'rgba(226,232,240,0.8)', fontSize: 12 }} />
                    <Tooltip
                      formatter={(value) => [
                        formatVal(hideValues, Number(value) || 0),
                        t('profitability.cumulativeRealized'),
                      ]}
                      labelFormatter={(label) => String(label ?? '')}
                      contentStyle={CHART_TOOLTIP_STYLE}
                      labelStyle={{ color: '#f8fafc' }}
                      itemStyle={{ color: '#e2e8f0' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="cumulativeRealized"
                      name={t('profitability.cumulativeRealized')}
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5, fill: '#f59e0b', stroke: '#0b1220', strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Attribution (realized only) */}
            <section className="profitabilitySection">
              <h2 className="profitabilitySectionTitle">{t('profitability.attribution')}</h2>
              <p className="profitabilitySectionDesc">{t('profitability.realizedPl')}</p>

              <p className="profitabilitySectionDesc">{t('profitability.byAssetClass')}</p>
              <div className="profitabilityChartArea profitabilityChartArea--md">
                <ResponsiveContainer>
                  <BarChart data={realizedAttribution?.byAssetClass ?? []}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                    <XAxis dataKey="key" tick={CHART_AXIS_TICK} />
                    <YAxis tick={CHART_AXIS_TICK} />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      labelStyle={{ color: '#f8fafc' }}
                      itemStyle={{ color: '#e2e8f0' }}
                      cursor={false}
                    />
                    <ReferenceLine y={0} stroke="#64748b" />
                    <Bar dataKey="realizedPnl" name={t('profitability.realizedPl')} activeBar={<ActiveAttributionBar />}>
                      {(realizedAttribution?.byAssetClass ?? []).map((entry, index) => (
                        <Cell key={`cls-${entry.key}-${index}`} fill={entry.realizedPnl >= 0 ? POS_BAR : NEG_BAR} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="profitabilityTwoCol">
                <div>
                  <p className="profitabilitySectionDesc">{t('profitability.contributors')}</p>
                  <div className="profitabilityChartArea profitabilityChartArea--md">
                    <ResponsiveContainer>
                      <BarChart
                        data={(realizedAttribution?.contributors ?? []).map((r) => ({
                          ...r,
                          label: `${r.symbol}`,
                        }))}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                        <XAxis dataKey="label" tick={CHART_AXIS_TICK} />
                        <YAxis tick={CHART_AXIS_TICK} />
                        <Tooltip
                          contentStyle={CHART_TOOLTIP_STYLE}
                          labelStyle={{ color: '#f8fafc' }}
                          itemStyle={{ color: '#e2e8f0' }}
                          cursor={false}
                        />
                        <ReferenceLine y={0} stroke="#64748b" />
                        <Bar dataKey="realizedPnl" name={t('profitability.realizedPl')} activeBar={<ActiveAttributionBar />}>
                          {(realizedAttribution?.contributors ?? []).map((entry, index) => (
                            <Cell key={`contrib-${entry.symbol}-${index}`} fill={entry.realizedPnl >= 0 ? POS_BAR : NEG_BAR} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div>
                  <p className="profitabilitySectionDesc">{t('profitability.detractors')}</p>
                  <div className="profitabilityChartArea profitabilityChartArea--md">
                    <ResponsiveContainer>
                      <BarChart
                        data={(realizedAttribution?.detractors ?? []).map((r) => ({
                          ...r,
                          label: `${r.symbol}`,
                        }))}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                        <XAxis dataKey="label" tick={CHART_AXIS_TICK} />
                        <YAxis tick={CHART_AXIS_TICK} />
                        <Tooltip
                          contentStyle={CHART_TOOLTIP_STYLE}
                          labelStyle={{ color: '#f8fafc' }}
                          itemStyle={{ color: '#e2e8f0' }}
                          cursor={false}
                        />
                        <ReferenceLine y={0} stroke="#64748b" />
                        <Bar dataKey="realizedPnl" name={t('profitability.realizedPl')} activeBar={<ActiveAttributionBar />}>
                          {(realizedAttribution?.detractors ?? []).map((entry, index) => (
                            <Cell key={`detract-${entry.symbol}-${index}`} fill={entry.realizedPnl >= 0 ? POS_BAR : NEG_BAR} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </section>

            {/* Trade analytics */}
            <section className="profitabilitySection">
              <h2 className="profitabilitySectionTitle">{t('profitability.tradeAnalytics')}</h2>

              <p className="profitabilitySectionDesc">{t('profitability.tradeReturnDistribution')}</p>
              <div className="profitabilityChartArea profitabilityChartArea--md">
                <ResponsiveContainer>
                  <BarChart
                    data={tradeReturnHistogram}
                    margin={{ left: -14, right: 10, top: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                    <XAxis
                      dataKey="bucket"
                      padding={{ left: 0, right: 0 }}
                      allowDataOverflow
                      tick={{ fill: 'rgba(226,232,240,0.8)', fontSize: 10 }}
                      tickMargin={0}
                      interval={2}
                    />
                    <YAxis
                      width={42}
                      tick={{ fill: 'rgba(226,232,240,0.8)', fontSize: 12 }}
                      tickMargin={0}
                    />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      labelStyle={{ color: '#f8fafc' }}
                      itemStyle={{ color: '#e2e8f0' }}
                      cursor={false}
                    />
                    <Bar
                      dataKey="count"
                      name="count"
                      fill="#a78bfa"
                      activeBar={<ActiveAttributionBar />}
                      barCategoryGap="0%"
                      barGap={0}
                      barSize={28}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="profitabilityTableWrap">
                <table className="profitabilityTable profitabilityTable--trades">
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
                        <td>{formatValByCurrency(hideValues, tr.proceeds, tr.currency)}</td>
                        <td>{formatValByCurrency(hideValues, tr.cost, tr.currency)}</td>
                        <td className={tr.pnl >= 0 ? 'pos' : 'neg'}>{formatValByCurrency(hideValues, tr.pnl, tr.currency)}</td>
                        <td>{hideValues ? '—' : (tr.returnPct == null ? '—' : formatPercent(tr.returnPct))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="profitabilityTableWrap">
                <table className="profitabilityTable profitabilityTable--trades">
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
                        <td>{formatValByCurrency(hideValues, tr.proceeds, tr.currency)}</td>
                        <td>{formatValByCurrency(hideValues, tr.cost, tr.currency)}</td>
                        <td className={tr.pnl >= 0 ? 'pos' : 'neg'}>{formatValByCurrency(hideValues, tr.pnl, tr.currency)}</td>
                        <td>{hideValues ? '—' : (tr.returnPct == null ? '—' : formatPercent(tr.returnPct))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

          </>
        )}
      </div>
    </section>
  );
}
