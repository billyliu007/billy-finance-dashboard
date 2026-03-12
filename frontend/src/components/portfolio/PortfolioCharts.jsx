import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ReferenceLine,
  Rectangle,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useMemo, useState } from 'react';
import { HOLDING_COLORS } from '../../constants.js';
import { formatMaybeHidden, formatMoney, formatPercent } from '../../utils/formatters.js';

function PnlTooltip({ active, payload, hideValues }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }

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
      <p style={{ margin: 0, color: '#f8fafc', fontWeight: 600 }}>{point.name}</p>
      <p style={{ margin: '4px 0 0' }}>
        P/L: {formatMaybeHidden(hideValues, formatMoney, Number(point.pnl) || 0)}
      </p>
      <p style={{ margin: '2px 0 0' }}>
        Return: {hideValues ? 'Hidden' : formatPercent(Number(point.pnlPct) || 0)}
      </p>
    </div>
  );
}

function ActiveAllocationShape(props) {
  const {
    cx,
    cy,
    startAngle,
    endAngle,
    innerRadius,
    outerRadius,
    fill,
  } = props;

  return (
    <g style={{ filter: 'drop-shadow(0 0 10px rgba(56,189,248,0.45))' }}>
      <Sector
        cx={cx}
        cy={cy}
        startAngle={startAngle}
        endAngle={endAngle}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 8}
        fill={fill}
        stroke="#67e8f9"
        strokeWidth={2}
      />
      <Sector
        cx={cx}
        cy={cy}
        startAngle={startAngle}
        endAngle={endAngle}
        innerRadius={outerRadius + 10}
        outerRadius={outerRadius + 13}
        fill="#67e8f9"
        fillOpacity={0.7}
        stroke="none"
      />
    </g>
  );
}

function ActivePnlBar(props) {
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

function PnlBarLabel({ x, y, width, height, index, data, hideValues }) {
  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    return null;
  }

  const point = Number.isInteger(index) ? data[index] : null;
  const pnl = Number(point?.pnl) || 0;
  const pnlPct = Number(point?.pnlPct) || 0;
  const labelText = `${formatMaybeHidden(hideValues, formatMoney, pnl)} (${hideValues ? 'Hidden' : formatPercent(pnlPct)})`;
  const labelInsidePadding = 8;
  const isTinyBar = width < 70;
  const labelX = isTinyBar
    ? pnl >= 0
      ? x + width + 8
      : x - 8
    : pnl >= 0
      ? x + width - labelInsidePadding
      : x + labelInsidePadding;
  const textAnchor = isTinyBar
    ? pnl >= 0
      ? 'start'
      : 'end'
    : pnl >= 0
      ? 'end'
      : 'start';
  const fill = isTinyBar ? '#e2e8f0' : '#0b1220';

  return (
    <text
      x={labelX}
      y={y + height / 2}
      dy={4}
      fill={fill}
      fontSize={11}
      fontWeight={600}
      textAnchor={textAnchor}
      style={{ paintOrder: 'stroke', stroke: 'rgba(15,23,42,0.55)', strokeWidth: 3 }}
    >
      {labelText}
    </text>
  );
}

function HoldingNameOnBarLabel({ x, y, width, height, index, data }) {
  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    return null;
  }
  const point = Number.isInteger(index) ? data[index] : null;
  const name = String(point?.name || '').trim();
  if (!name) return null;
  if (width < 55) return null;

  const pnl = Number(point?.pnl) || 0;
  const padding = 8;
  const labelX = pnl >= 0 ? x + padding : x + width - padding;
  const textAnchor = pnl >= 0 ? 'start' : 'end';

  return (
    <text
      x={labelX}
      y={y + height / 2}
      dy={4}
      fill="#0b1220"
      fontSize={11}
      fontWeight={700}
      textAnchor={textAnchor}
      style={{ paintOrder: 'stroke', stroke: 'rgba(15,23,42,0.55)', strokeWidth: 3 }}
    >
      {name}
    </text>
  );
}

export default function PortfolioCharts({ hideValues, allocationData, chartData, assetColorMap }) {
  const [activePieIndex, setActivePieIndex] = useState(-1);
  const pieCells = useMemo(
    () => allocationData.map((entry, index) => ({
      key: `${entry.name}-alloc-${index}`,
      fill: assetColorMap.get(entry.name) || HOLDING_COLORS[index % HOLDING_COLORS.length],
    })),
    [allocationData, assetColorMap],
  );

  return (
    <div className="portfolioCharts">
      <article className="chartCard">
        <h2>Holdings Allocation (% of Market Value)</h2>
        <div className="chartArea compact">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={allocationData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={95}
                paddingAngle={2}
                isAnimationActive={false}
                activeIndex={activePieIndex}
                activeShape={<ActiveAllocationShape />}
                onMouseEnter={(_, index) => setActivePieIndex(index)}
                onMouseLeave={() => setActivePieIndex(-1)}
                labelLine={false}
                label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(1)}%`}
              >
                {pieCells.map((cell) => (
                  <Cell
                    key={cell.key}
                    fill={cell.fill}
                    stroke="#0b1220"
                    strokeWidth={2}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => formatMaybeHidden(hideValues, formatMoney, Number(value) || 0)}
                contentStyle={{
                  backgroundColor: '#0b1220',
                  border: '1px solid #334155',
                  borderRadius: '10px',
                  color: '#e2e8f0',
                }}
                labelStyle={{ color: '#f8fafc' }}
                itemStyle={{ color: '#e2e8f0' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className="chartCard">
        <h2>Unrealized P/L by Holding</h2>
        <div className="chartArea compact">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 18, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                type="number"
                tickFormatter={(value) => formatMaybeHidden(hideValues, formatMoney, Number(value) || 0, '')}
                tick={{ fill: '#94a3b8', fontSize: 12 }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={10}
                interval={0}
                tick={false}
                tickLine={false}
              />
              <Tooltip
                content={<PnlTooltip hideValues={hideValues} />}
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
              <ReferenceLine x={0} stroke="#64748b" />
              <Bar dataKey="pnl" radius={[4, 4, 4, 4]} activeBar={<ActivePnlBar />}>
                <LabelList content={(props) => (
                  <HoldingNameOnBarLabel
                    {...props}
                    data={chartData}
                  />
                )}
                />
                <LabelList content={(props) => (
                  <PnlBarLabel
                    {...props}
                    hideValues={hideValues}
                    data={chartData}
                  />
                )}
                />
                {chartData.map((entry, index) => (
                  <Cell
                    key={`${entry.name}-pnl-${index}`}
                    fill={assetColorMap.get(entry.name) || HOLDING_COLORS[index % HOLDING_COLORS.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>
    </div>
  );
}
