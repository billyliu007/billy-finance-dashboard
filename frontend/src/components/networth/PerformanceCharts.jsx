import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useEffect, useState } from 'react';
import { formatCny, formatMaybeHidden, formatPercent } from '../../utils/formatters.js';

function formatDateOnlyLabel(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) {
    return '';
  }

  if (raw.includes('T')) {
    return raw.split('T')[0];
  }

  if (raw.includes(' ')) {
    return raw.split(' ')[0];
  }

  return raw;
}

function MarkerLabel({ viewBox, value, color, side = 'top', offsetY = 0 }) {
  if (!viewBox || !value) {
    return null;
  }

  const labelText = String(value);
  const approxCharWidth = 6.5;
  const boxWidth = Math.max(68, Math.round(labelText.length * approxCharWidth + 12));
  const boxHeight = 20;
  let x = viewBox.x - boxWidth / 2;
  let y = viewBox.y - 30 + offsetY;

  if (side === 'left') {
    x = viewBox.x - boxWidth - 10;
    y = viewBox.y - boxHeight / 2 + offsetY;
  } else if (side === 'right') {
    x = viewBox.x + 10;
    y = viewBox.y - boxHeight / 2 + offsetY;
  } else if (side === 'bottom') {
    x = viewBox.x - boxWidth / 2;
    y = viewBox.y + 10 + offsetY;
  }

  x = Math.max(4, x);
  y = Math.max(4, y);

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={boxWidth}
        height={boxHeight}
        rx={6}
        fill="rgba(2, 6, 23, 0.88)"
        stroke={color}
        strokeWidth={1}
      />
      <text
        x={x + boxWidth / 2}
        y={y + 13}
        textAnchor="middle"
        fill="#e2e8f0"
        fontSize={11}
        fontWeight={600}
      >
        {labelText}
      </text>
    </g>
  );
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

function PeriodReturnTooltip({ active, payload, hideValues }) {
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
      <p style={{ margin: 0, color: '#f8fafc', fontWeight: 600 }}>{point.date}</p>
      <p style={{ margin: '4px 0 0' }}>
        Prev month-end:{' '}
        {point.previousNetWorth == null
          ? '-'
          : formatMaybeHidden(hideValues, formatCny, Number(point.previousNetWorth) || 0)}
      </p>
      <p style={{ margin: '2px 0 0' }}>
        Current month-end:{' '}
        {formatMaybeHidden(hideValues, formatCny, Number(point.currentNetWorth) || 0)}
      </p>
      <p style={{ margin: '2px 0 0' }}>
        MoM Return: {hideValues ? 'Hidden' : formatPercent(Number(point.derivedChangePct) || 0)}
      </p>
    </div>
  );
}

export default function PerformanceCharts({ hideValues, cashflowData, derivedSeries, netWorthDomain }) {
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

  const dateIndexByDate = new Map(cashflowData.map((item, index) => [item.date, index]));
  const markerEntries = Array.from(markerByPoint.values()).map((marker) => {
    const isHigh = marker.labels.includes('High');
    const positionIndex = dateIndexByDate.get(marker.point.date) ?? 0;
    const side = isHigh
      ? 'top'
      : positionIndex > cashflowData.length * 0.65
        ? 'left'
        : 'right';

    return {
      ...marker,
      side,
      offsetY: 0,
    };
  });

  const latestMarker = markerEntries.find((item) => item.labels.includes('Latest'));
  const lowMarker = markerEntries.find((item) => item.labels.includes('Low'));
  const netWorthSpan = Math.max(
    1,
    (highPoint?.netWorth ?? 0) - (lowPoint?.netWorth ?? 0),
  );
  const isLatestLowTooClose = latestMarker
    && lowMarker
    && latestMarker !== lowMarker
    && Math.abs(latestMarker.point.netWorth - lowMarker.point.netWorth) < netWorthSpan * 0.09;

  if (isLatestLowTooClose) {
    latestMarker.offsetY = -16;
    lowMarker.offsetY = 16;
  }

  return (
    <div className="portfolioCharts">
      <article className="chartCard">
        <h2>Net Worth Trend</h2>
        <div className="chartArea compact">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cashflowData} margin={{ top: 28, right: 12, left: isSmallScreen ? 6 : 24, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tickFormatter={formatDateOnlyLabel} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis
                domain={netWorthDomain}
                tick={isSmallScreen ? false : { fill: '#94a3b8', fontSize: 12 }}
                tickLine={!isSmallScreen}
                tickFormatter={isSmallScreen ? undefined : (value) => formatMaybeHidden(hideValues, formatCny, Number(value) || 0, '')}
                width={isSmallScreen ? 8 : 120}
                tickMargin={isSmallScreen ? 0 : 6}
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
              {markerEntries.map((marker) => (
                <ReferenceDot
                  key={`${marker.point.date}-${marker.point.netWorth}`}
                  x={marker.point.date}
                  y={marker.point.netWorth}
                  r={5}
                  fill={marker.color}
                  stroke="#0b1220"
                  strokeWidth={2}
                  className={marker.labels.includes('Latest') ? 'trendDot trendDotLatest' : 'trendDot'}
                  label={(props) => (
                    <MarkerLabel
                      viewBox={props.viewBox}
                      color={marker.color}
                      side={marker.side}
                      offsetY={marker.offsetY}
                      value={`${marker.labels.join('/')} ${formatMaybeHidden(hideValues, formatCny, marker.point.netWorth, 'Hidden')}`}
                    />
                  )}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className="chartCard">
        <h2>Monthly Return (Month-End, %)</h2>
        <div className="chartArea compact">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={derivedSeries} margin={{ top: 8, right: 18, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tickFormatter={formatDateOnlyLabel} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis tickFormatter={(value) => `${value}%`} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip
                content={<PeriodReturnTooltip hideValues={hideValues} />}
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
