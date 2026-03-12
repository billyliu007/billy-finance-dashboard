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

function HoldingAxisTick({ y, payload }) {
  return (
    <text x={0} y={y} dy={5} fill="#cbd5e1" fontSize={12} textAnchor="start">
      {payload.value}
    </text>
  );
}

function AllocationPieLabel({ x, y, name, percent }) {
  if (![x, y].every((v) => Number.isFinite(v))) return null;
  const pct = `${((percent || 0) * 100).toFixed(1)}%`;
  const labelName = String(name || '').trim();
  if (!labelName) return null;

  return (
    <text x={x} y={y} fill="#e2e8f0" fontSize={11} textAnchor="middle">
      <tspan x={x} dy={-2} fontWeight={700}>
        {labelName}
      </tspan>
      <tspan x={x} dy={13} fill="#cbd5e1" fontWeight={600}>
        {pct}
      </tspan>
    </text>
  );
}

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
  const line1 = formatMaybeHidden(hideValues, formatMoney, pnl);
  const line2 = hideValues ? 'Hidden' : formatPercent(pnlPct);
  const labelX = pnl >= 0 ? x + width + 8 : x - 8;
  const textAnchor = pnl >= 0 ? 'start' : 'end';

  return (
    <text x={labelX} y={y + height / 2} dy={-1} fill="#e2e8f0" fontSize={11} textAnchor={textAnchor}>
      <tspan x={labelX} dy={0} fontWeight={700}>
        {line1}
      </tspan>
      <tspan x={labelX} dy={13} fill="#cbd5e1" fontWeight={600}>
        {line2}
      </tspan>
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
                label={(props) => <AllocationPieLabel {...props} />}
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
                width={74}
                interval={0}
                tick={<HoldingAxisTick />}
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
