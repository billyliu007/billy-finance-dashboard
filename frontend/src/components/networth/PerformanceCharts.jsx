import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useEffect, useState } from 'react';
import { formatBaseCurrency, formatLocalDateTime, formatMaybeHidden, formatPercent } from '../../utils/formatters.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';
import TrendLineChartWithMarkers, { formatTrendXAxisLabel } from '../charts/TrendLineChartWithMarkers.jsx';

const NET_WORTH_X_KEY = 'dateTimeLabel';

function formatTrendXAxisLabelCompact(rawValue) {
  const full = formatTrendXAxisLabel(rawValue);
  if (full.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(full)) {
    return full.slice(5, 10);
  }
  return full;
}

function formatMonthXAxisLabel(rawValue) {
  const full = formatTrendXAxisLabel(rawValue);
  // Monthly return chart: show YYYY-MM only to avoid overlap.
  if (full.length >= 7 && /^\d{4}-\d{2}/.test(full)) {
    return full.slice(0, 7);
  }
  return full;
}

function ActivePeriodBar(props) {
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

function PeriodReturnTooltip({ active, payload, hideValues, baseCurrency = 'USD', t }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }

  const formatValue = (v) => formatBaseCurrency(v, baseCurrency);

  return (
    <div
      style={{
        backgroundColor: '#0b1220',
        border: '1px solid #334155',
        borderRadius: '10px',
        color: '#e2e8f0',
        padding: '8px 10px',
      }}
    >
      <p style={{ margin: 0, color: '#f8fafc', fontWeight: 600 }}>
        {formatLocalDateTime(point.recordedAtUtc || point.dateTimeLabel || point.date)}
      </p>
      <p style={{ margin: '4px 0 0' }}>
        {t('netWorth.chartTooltipPrevMonthEnd')}{' '}
        {point.previousNetWorth == null
          ? '-'
          : formatMaybeHidden(hideValues, formatValue, Number(point.previousNetWorth) || 0, t('app.hidden'))}
      </p>
      <p style={{ margin: '2px 0 0' }}>
        {t('netWorth.chartTooltipCurrentMonthEnd')}{' '}
        {formatMaybeHidden(hideValues, formatValue, Number(point.currentNetWorth) || 0, t('app.hidden'))}
      </p>
      <p style={{ margin: '2px 0 0' }}>
        {t('netWorth.chartTooltipMoMReturn')}{' '}
        {hideValues ? t('app.hidden') : formatPercent(Number(point.derivedChangePct) || 0)}
      </p>
    </div>
  );
}

export default function PerformanceCharts({ hideValues, cashflowData, derivedSeries, netWorthDomain, baseCurrency = 'USD' }) {
  const { t } = useLanguage();
  const formatValue = (v) => formatBaseCurrency(v, baseCurrency);
  const [isSmallScreen, setIsSmallScreen] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 980px)');
    const update = () => setIsSmallScreen(mediaQuery.matches);

    update();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  // Keep chart plot areas vertically aligned across the two cards (desktop + responsive).
  const CHART_MARGIN = isSmallScreen
    ? { top: 24, right: 10, left: 10, bottom: 46 }
    : { top: 28, right: 18, left: 10, bottom: 28 };

  return (
    <div className="portfolioCharts">
      <article className="chartCard">
        <h2>{t('netWorth.netWorthTrend')}</h2>
        <div className="chartArea compact">
          <TrendLineChartWithMarkers
            data={cashflowData}
            xDataKey={NET_WORTH_X_KEY}
            yDataKey="netWorth"
            hideValues={hideValues}
            formatDisplayValue={(v) => formatValue(v)}
            tooltipSeriesName={t('netWorth.tooltipNetWorth')}
            stroke="#22d3ee"
            strokeWidth={2.5}
            yDomain={netWorthDomain}
            tooltipUseDateTime
          />
        </div>
      </article>

      <article className="chartCard">
        <h2>{t('netWorth.monthlyReturn')}</h2>
        <div className="chartArea compact">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={derivedSeries} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="date"
                tickFormatter={isSmallScreen ? formatTrendXAxisLabelCompact : formatMonthXAxisLabel}
                tick={{
                  fill: '#94a3b8',
                  fontSize: isSmallScreen ? 11 : 12,
                  angle: isSmallScreen ? -35 : 0,
                  textAnchor: isSmallScreen ? 'end' : 'middle',
                }}
                height={isSmallScreen ? 46 : undefined}
                tickMargin={isSmallScreen ? 10 : 12}
                interval={isSmallScreen ? 'preserveStartEnd' : derivedSeries.length <= 12 ? 0 : 'preserveStartEnd'}
                minTickGap={isSmallScreen ? 26 : 34}
              />
              <YAxis tickFormatter={(value) => `${value}%`} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip
                content={<PeriodReturnTooltip hideValues={hideValues} baseCurrency={baseCurrency} t={t} />}
                cursor={false}
                contentStyle={{
                  backgroundColor: '#0b1220',
                  border: '1px solid #334155',
                  borderRadius: '10px',
                  color: '#e2e8f0',
                }}
                labelStyle={{ color: '#f8fafc' }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <ReferenceLine y={0} stroke="#64748b" />
              <Bar dataKey="derivedChangePct" radius={[4, 4, 0, 0]} activeBar={<ActivePeriodBar />}>
                {derivedSeries.map((entry, index) => (
                  <Cell key={`${entry.date}-${index}`} fill={entry.derivedChangePct >= 0 ? '#22c55e' : '#fb7185'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>
    </div>
  );
}
