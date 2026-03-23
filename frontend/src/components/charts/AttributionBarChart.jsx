import { useLanguage } from '../../contexts/LanguageContext.jsx';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Rectangle,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMaybeHidden, formatMoney } from '../../utils/formatters.js';

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

export default function AttributionBarChart({ data, xKey, hideValues }) {
  const { t } = useLanguage();
  return (
    <div className="profitabilityChartArea profitabilityChartArea--md">
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
          <XAxis dataKey={xKey} tick={CHART_AXIS_TICK} />
          <YAxis
            tick={CHART_AXIS_TICK}
            tickFormatter={(v) => formatMaybeHidden(hideValues, formatMoney, Number(v) || 0, '')}
          />
          <Tooltip
            formatter={(value) => [
              formatMaybeHidden(hideValues, formatMoney, Number(value) || 0, t('app.hidden')),
              t('profitability.realizedPl'),
            ]}
            contentStyle={CHART_TOOLTIP_STYLE}
            labelStyle={{ color: '#f8fafc' }}
            itemStyle={{ color: '#e2e8f0' }}
            cursor={false}
          />
          <ReferenceLine y={0} stroke="#64748b" />
          <Bar dataKey="realizedPnl" name={t('profitability.realizedPl')} activeBar={<ActiveAttributionBar />}>
            {(data || []).map((entry, index) => (
              <Cell key={`bar-${index}`} fill={entry.realizedPnl >= 0 ? POS_BAR : NEG_BAR} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
