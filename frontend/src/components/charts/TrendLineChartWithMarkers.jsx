import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatLocalDateTime, formatMaybeHidden } from '../../utils/formatters.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

export function formatTrendXAxisLabel(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  if (raw.includes('T')) return raw.split('T')[0];
  if (raw.includes(' ')) return raw.split(' ')[0];
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

  const padding = 4;
  const minX = padding;
  const minY = padding;
  const maxX = (viewBox.x ?? 0) + (viewBox.width ?? 0) - boxWidth - padding;
  const maxY = (viewBox.y ?? 0) + (viewBox.height ?? 0) - boxHeight - padding;

  x = Math.min(Math.max(minX, x), Number.isFinite(maxX) ? maxX : x);
  y = Math.min(Math.max(minY, y), Number.isFinite(maxY) ? maxY : y);

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

/**
 * Net-worth-style line chart: grid, axes, tooltip, Latest/High/Low reference dots + labels.
 */
export default function TrendLineChartWithMarkers({
  data = [],
  xDataKey,
  yDataKey,
  hideValues,
  formatDisplayValue,
  tooltipSeriesName,
  stroke = '#22d3ee',
  strokeWidth = 2.5,
  yDomain,
  /** When true, tooltip x label uses formatLocalDateTime (net worth points). Otherwise formatTrendXAxisLabel only. */
  tooltipUseDateTime = false,
}) {
  const { t } = useLanguage();
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

  const latestPoint = data.length > 0 ? data[data.length - 1] : null;
  const highPoint =
    data.length > 0
      ? data.reduce(
          (acc, item) => (Number(item[yDataKey]) > Number(acc[yDataKey]) ? item : acc),
          data[0],
        )
      : null;
  const lowPoint =
    data.length > 0
      ? data.reduce(
          (acc, item) => (Number(item[yDataKey]) < Number(acc[yDataKey]) ? item : acc),
          data[0],
        )
      : null;

  const markerByPoint = new Map();
  [
    { point: latestPoint, label: 'Latest', color: '#22d3ee' },
    { point: highPoint, label: 'High', color: '#22c55e' },
    { point: lowPoint, label: 'Low', color: '#fb7185' },
  ].forEach(({ point, label, color }) => {
    if (!point) return;

    const xValue = point[xDataKey];
    const yVal = Number(point[yDataKey]);
    const key = `${xValue}|${yVal}`;
    const existing = markerByPoint.get(key);
    if (!existing) {
      markerByPoint.set(key, { point, labels: [label], color });
      return;
    }
    existing.labels.push(label);
  });

  const dateIndexByDate = new Map(data.map((item, index) => [item[xDataKey], index]));
  const markerEntries = Array.from(markerByPoint.values()).map((marker) => {
    const isHigh = marker.labels.includes('High');
    const positionIndex = dateIndexByDate.get(marker.point[xDataKey]) ?? 0;
    const side = isHigh ? 'top' : positionIndex > data.length * 0.65 ? 'left' : 'right';

    return {
      ...marker,
      side,
      offsetY: 0,
    };
  });

  const latestMarker = markerEntries.find((item) => item.labels.includes('Latest'));
  const lowMarker = markerEntries.find((item) => item.labels.includes('Low'));
  const ySpan = Math.max(1, Number(highPoint?.[yDataKey] ?? 0) - Number(lowPoint?.[yDataKey] ?? 0));
  const isLatestLowTooClose =
    latestMarker &&
    lowMarker &&
    latestMarker !== lowMarker &&
    Math.abs(Number(latestMarker.point[yDataKey]) - Number(lowMarker.point[yDataKey])) < ySpan * 0.09;

  if (isLatestLowTooClose) {
    latestMarker.offsetY = -16;
    lowMarker.offsetY = 16;
  }

  const formatForTooltip = (v) => formatDisplayValue(Number(v) || 0);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 28, right: 12, left: isSmallScreen ? 6 : 24, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis
          dataKey={xDataKey}
          tickFormatter={formatTrendXAxisLabel}
          tick={{ fill: '#94a3b8', fontSize: 12 }}
        />
        <YAxis
          domain={yDomain}
          tick={isSmallScreen ? false : { fill: '#94a3b8', fontSize: 12 }}
          tickLine={!isSmallScreen}
          tickFormatter={
            isSmallScreen ? undefined : (value) => formatMaybeHidden(hideValues, formatForTooltip, Number(value) || 0, '')
          }
          width={isSmallScreen ? 8 : 120}
          tickMargin={isSmallScreen ? 0 : 6}
        />
        <Tooltip
          formatter={(value) => [
            formatMaybeHidden(hideValues, formatForTooltip, Number(value) || 0, t('app.hidden')),
            tooltipSeriesName,
          ]}
          labelFormatter={(label, payload) => {
            const point = payload?.[0]?.payload;
            if (tooltipUseDateTime) {
              return formatLocalDateTime(point?.recordedAtUtc || point?.dateTimeLabel || label);
            }
            return formatTrendXAxisLabel(point?.[xDataKey] ?? label);
          }}
          contentStyle={{
            backgroundColor: '#0b1220',
            border: '1px solid #334155',
            borderRadius: '10px',
            color: '#e2e8f0',
          }}
          labelStyle={{ color: '#f8fafc' }}
          itemStyle={{ color: '#e2e8f0' }}
        />
        <Line
          type="monotone"
          dataKey={yDataKey}
          stroke={stroke}
          strokeWidth={strokeWidth}
          dot={false}
          activeDot={{ r: 5, fill: stroke, stroke: '#0b1220', strokeWidth: 2 }}
        />
        {markerEntries.map((marker) => (
          <ReferenceDot
            key={`${marker.point[xDataKey]}-${marker.point[yDataKey]}`}
            x={marker.point[xDataKey]}
            y={marker.point[yDataKey]}
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
                value={`${marker.labels
                  .map((lbl) => {
                    if (lbl === 'Latest') return t('netWorth.chartMarkerLatest');
                    if (lbl === 'High') return t('netWorth.chartMarkerHigh');
                    if (lbl === 'Low') return t('netWorth.chartMarkerLow');
                    return lbl;
                  })
                  .join('/')} ${formatMaybeHidden(
                  hideValues,
                  formatForTooltip,
                  Number(marker.point[yDataKey]) || 0,
                  t('app.hidden'),
                )}`}
              />
            )}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
