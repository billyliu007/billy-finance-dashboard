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
import { formatBaseCurrency, formatLocalDateTime, formatMaybeHidden, formatPercent } from '../../utils/formatters.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';
import TrendLineChartWithMarkers, { formatTrendXAxisLabel } from '../charts/TrendLineChartWithMarkers.jsx';

const NET_WORTH_X_KEY = 'dateTimeLabel';

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
            <BarChart data={derivedSeries} margin={{ top: 8, right: 18, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tickFormatter={formatTrendXAxisLabel} tick={{ fill: '#94a3b8', fontSize: 12 }} />
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
