import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCny, formatMaybeHidden, formatPercent } from '../../utils/formatters';

export default function PerformanceCharts({ hideValues, cashflowData, derivedSeries, netWorthDomain }) {
  return (
    <div className="portfolioCharts">
      <article className="chartCard">
        <h2>Net Worth Time Series</h2>
        <div className="chartArea compact">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cashflowData} margin={{ top: 8, right: 18, left: 24, bottom: 8 }}>
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
            </LineChart>
          </ResponsiveContainer>
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
