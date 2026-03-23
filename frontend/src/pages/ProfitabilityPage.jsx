import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import TrendLineChartWithMarkers from '../components/charts/TrendLineChartWithMarkers.jsx';
import AttributionBarChart from '../components/charts/AttributionBarChart.jsx';
import TradeHistoryTable from '../components/TradeHistoryTable.jsx';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import useApiData from '../hooks/useApiData.js';
import { startOfYearDateOnly, subtractMonthsDateOnly, todayDateOnly } from '../utils/dateOnly.js';
import { formatCurrencyValue, formatMaybeHidden, formatMoney, formatPercent } from '../utils/formatters.js';

function formatTradingUsd(hideValues, v) {
  return formatMaybeHidden(hideValues, formatMoney, Number(v) || 0);
}

function formatValByCurrency(hideValues, v, currency) {
  if (hideValues) return '—';
  return formatCurrencyValue(Number(v) || 0, currency || 'USD');
}

function ActiveAttributionBar(props) {
  const { x, y, width, height, fill } = props;
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

export default function ProfitabilityPage({ hideValues }) {
  const { t } = useLanguage();

  const [timeframe, setTimeframe] = useState('since');
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

  const { data: analytics, isLoading, error: analyticsError } = useApiData(tradingPerformancePath);

  const portfolioIsEmpty = Boolean(analytics?.portfolioIsEmpty);
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
        {isLoading && <p>{t('app.loadingDashboard')}</p>}
        {!isLoading && analyticsError && <p className="error">{analyticsError}</p>}

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

        {!isLoading && !analyticsError && portfolioIsEmpty && <p>{t('profitability.noHoldings')}</p>}

        {!isLoading && !analyticsError && !portfolioIsEmpty && summary && (
          <>
            <section className="profitabilitySection">
              <h2 className="profitabilitySectionTitle">{t('profitability.yourPortfolio')}</h2>
              <div className="kpiRow kpiRow--items-5">
                <article className="miniKpi">
                  <p>{t('profitability.realizedPl')}</p>
                  <h3 className={Number(summary.realized?.pnl) >= 0 ? 'pos' : 'neg'}>
                    {formatTradingUsd(hideValues, summary.realized?.pnl)}
                  </h3>
                  <small className={Number(summary.realized?.pnl) >= 0 ? 'pos' : 'neg'}>
                    {hideValues ? t('app.hidden') : formatPercent(summary.realized?.pct ?? 0)}
                  </small>
                </article>
                <article className="miniKpi">
                  <p className="miniKpiLabelRow">
                    <span>{t('profitability.winRate')}</span>
                    <span className="profitabilityInfoWrap">
                      <button type="button" className="profitabilityInfoDot" aria-label={t('profitability.winRateHelp')}>
                        ⓘ
                      </button>
                      <span className="profitabilityTooltip" role="tooltip">
                        {t('profitability.winRateHelp')}
                      </span>
                    </span>
                  </p>
                  <h3>
                    {formatMaybeHidden(hideValues, (x) => formatPercent(x), Number(summary.winStats?.winRate) || 0, t('app.hidden'))}
                  </h3>
                </article>
                <article className="miniKpi">
                  <p className="miniKpiLabelRow">
                    <span>{t('profitability.profitFactor')}</span>
                    <span className="profitabilityInfoWrap">
                      <button type="button" className="profitabilityInfoDot" aria-label={t('profitability.profitFactorHelp')}>
                        ⓘ
                      </button>
                      <span className="profitabilityTooltip" role="tooltip">
                        {t('profitability.profitFactorHelp')}
                      </span>
                    </span>
                  </p>
                  <h3>
                    {hideValues
                      ? t('app.hidden')
                      : summary.winStats?.profitFactor == null
                        ? '—'
                        : Number(summary.winStats.profitFactor).toFixed(2)}
                  </h3>
                </article>
                <article className="miniKpi">
                  <p>{t('profitability.avgWin')}</p>
                  <h3 className={Number(summary.winStats?.avgWin) >= 0 ? 'pos' : 'neg'}>
                    {formatTradingUsd(hideValues, summary.winStats?.avgWin)}
                  </h3>
                </article>
                <article className="miniKpi">
                  <p>{t('profitability.avgLoss')}</p>
                  <h3 className={Number(summary.winStats?.avgLoss) >= 0 ? 'pos' : 'neg'}>
                    {formatTradingUsd(hideValues, summary.winStats?.avgLoss)}
                  </h3>
                </article>
              </div>
            </section>

            <div className="portfolioCharts portfolioCharts--single">
              <article className="chartCard">
                <h2>{t('profitability.performanceOverTime')}</h2>
                <p className="chartCardSubtitle">{t('profitability.cumulativeRealized')}</p>
                <div className="chartArea compact">
                  <TrendLineChartWithMarkers
                    data={monthlyStacked}
                    xDataKey="month"
                    yDataKey="cumulativeRealized"
                    hideValues={hideValues}
                    formatDisplayValue={(v) => formatMoney(Number(v) || 0)}
                    tooltipSeriesName={t('profitability.cumulativeRealized')}
                    stroke="#f59e0b"
                    strokeWidth={2}
                  />
                </div>
              </article>
            </div>

            <section className="profitabilitySection">
              <h2 className="profitabilitySectionTitle">{t('profitability.attribution')}</h2>
              <p className="profitabilitySectionDesc">{t('profitability.realizedPl')}</p>

              <p className="profitabilitySectionDesc">{t('profitability.byAssetClass')}</p>
              <AttributionBarChart
                data={realizedAttribution?.byAssetClass ?? []}
                xKey="key"
                hideValues={hideValues}
              />

              <div className="profitabilityTwoCol">
                <div>
                  <p className="profitabilitySectionDesc">{t('profitability.contributors')}</p>
                  <AttributionBarChart
                    data={(realizedAttribution?.contributors ?? []).map((r) => ({
                      ...r,
                      label: `${r.symbol}`,
                    }))}
                    xKey="label"
                    hideValues={hideValues}
                  />
                </div>
                <div>
                  <p className="profitabilitySectionDesc">{t('profitability.detractors')}</p>
                  <AttributionBarChart
                    data={(realizedAttribution?.detractors ?? []).map((r) => ({
                      ...r,
                      label: `${r.symbol}`,
                    }))}
                    xKey="label"
                    hideValues={hideValues}
                  />
                </div>
              </div>
            </section>

            <section className="profitabilitySection">
              <h2 className="profitabilitySectionTitle">{t('profitability.tradeAnalytics')}</h2>

              <p className="profitabilitySectionDesc">{t('profitability.tradeReturnDistribution')}</p>
              <div className="profitabilityChartArea profitabilityChartArea--md">
                <ResponsiveContainer>
                  <BarChart data={tradeReturnHistogram} margin={{ left: -14, right: 10, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                    <XAxis
                      dataKey="bucket"
                      padding={{ left: 0, right: 0 }}
                      allowDataOverflow
                      tick={{ fill: 'rgba(226,232,240,0.8)', fontSize: 10 }}
                      tickMargin={0}
                      interval={2}
                    />
                    <YAxis width={42} tick={{ fill: 'rgba(226,232,240,0.8)', fontSize: 12 }} tickMargin={0} />
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

              <TradeHistoryTable
                trades={trades?.best ?? []}
                title={t('profitability.bestTrades')}
                hideValues={hideValues}
              />

              <TradeHistoryTable
                trades={trades?.worst ?? []}
                title={t('profitability.worstTrades')}
                hideValues={hideValues}
              />
            </section>
          </>
        )}
      </div>
    </section>
  );
}
