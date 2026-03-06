import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCny, formatMaybeHidden, formatPercent } from '../../utils/formatters';

export default function PerformanceCharts({ hideValues, cashflowData, derivedSeries, netWorthDomain }) {
  const latestPoint = cashflowData.length > 0 ? cashflowData[cashflowData.length - 1] : null;
  const highPoint = cashflowData.length > 0
    ? cashflowData.reduce((acc, item) => (item.netWorth > acc.netWorth ? item : acc), cashflowData[0])
    : null;
  const lowPoint = cashflowData.length > 0
    ? cashflowData.reduce((acc, item) => (item.netWorth < acc.netWorth ? item : acc), cashflowData[0])
    : null;

  const markerByPoint = new Map();
  [
    { point: latestPoint, label: 'Latest', color: '#22d3ee' },
    { point: highPoint, label: 'High', color: '#22c55e' },
    { point: lowPoint, label: 'Low', color: '#fb7185' },
  ].forEach(({ point, label, color }) => {
    if (!point) {
      return;
    }

    const key = `${point.date}|${point.netWorth}`;
    const existing = markerByPoint.get(key);
    if (!existing) {
      markerByPoint.set(key, { point, labels: [label], color });
      return;
    }

    existing.labels.push(label);
  });

  const markerSummary = [
    { key: 'latest', label: 'Latest', point: latestPoint, colorClass: 'trendLatest' },
    { key: 'high', label: 'High', point: highPoint, colorClass: 'trendHigh' },
    { key: 'low', label: 'Low', point: lowPoint, colorClass: 'trendLow' },
  ].filter((item) => item.point);

  return (
    <div className="portfolioCharts">
      <article className="chartCard">
        <h2>Net Worth Trend</h2>
        <div className="chartArea compact">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cashflowData} margin={{ top: 28, right: 18, left: 24, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis
                domain={netWorthDomain}
                tickFormatter={(value) => formatMaybeHidden(hideValues, formatCny, Number(value) || 0, '')}
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                width={120}
                tickMargin={6}
              />
              <Tooltip
                formatter={(value) => formatMaybeHidden(hideValues, formatCny, Number(value) || 0)}
                contentStyle={{
                  backgroundColor: '#0b1220',
                  border: '1px solid #334155',
                  borderRadius: '10px',
                  color: '#e2e8f0',
                }}
                labelStyle={{ color: '#f8fafc' }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Line type="monotone" dataKey="netWorth" stroke="#22d3ee" strokeWidth={2.5} dot={false} />
              {Array.from(markerByPoint.values()).map((marker) => (
                <ReferenceDot
                  key={`${marker.point.date}-${marker.point.netWorth}`}
                  x={marker.point.date}
                  y={marker.point.netWorth}
                  r={4}
                  fill={marker.color}
                  stroke="#0b1220"
                  strokeWidth={1.5}
                  label={{
                    value: `${marker.labels.join('/')} ${formatMaybeHidden(hideValues, formatCny, marker.point.netWorth, 'Hidden')}`,
                    position: 'insideTop',
                    fill: '#cbd5e1',
                    fontSize: 11,
                  }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="trendMarkers">
          {markerSummary.map((item) => (
            <p key={item.key} className={item.colorClass}>
              <span>{item.label}</span>
              <strong>{formatMaybeHidden(hideValues, formatCny, item.point.netWorth, 'Hidden')}</strong>
            </p>
          ))}
        </div>
      </article>

      <article className="chartCard">
        <h2>Period Return (%)</h2>
        <div className="chartArea compact">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={derivedSeries} margin={{ top: 8, right: 18, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis tickFormatter={(value) => `${value}%`} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip
                formatter={(value) => formatPercent(Number(value) || 0)}
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
              <Bar dataKey="derivedChangePct" radius={[4, 4, 0, 0]}>
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
