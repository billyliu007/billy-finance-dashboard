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
  usePlotArea,
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

function formatTrendXAxisLabelCompact(rawValue) {
  const full = formatTrendXAxisLabel(rawValue);
  // Prefer MM-DD on small screens to avoid unreadable ticks.
  if (full.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(full)) {
    return full.slice(5, 10);
  }
  return full;
}

/**
 * Recharts 3 ReferenceDot passes label `viewBox` as the dot's bounding rect (≈2r×2r), not the plot.
 * Center = viewBox.x + width/2; use usePlotArea() for real plot bounds when clamping.
 */
function MarkerLabel({ viewBox, value, color, side = 'top', offsetY = 0 }) {
  const plotArea = usePlotArea();

  if (!viewBox || !value) {
    return null;
  }

  const labelText = String(value);
  const approxCharWidth = 6.5;
  const boxWidth = Math.max(68, Math.round(labelText.length * approxCharWidth + 12));
  const boxHeight = 20;
  const edgePad = 8;
  const dotW = viewBox.width ?? 0;
  const dotH = viewBox.height ?? 0;
  const cx = (viewBox.x ?? 0) + dotW / 2;
  const cy = (viewBox.y ?? 0) + dotH / 2;

  const plotX = plotArea?.x ?? 0;
  const plotY = plotArea?.y ?? 0;
  const plotW = plotArea?.width ?? 0;
  const plotH = plotArea?.height ?? 0;
  const plotRight = plotX + plotW;
  const plotBottom = plotY + plotH;

  let effectiveSide = side;
  // Prefer placing labels inside the plot; flip horizontal side if it would clip past plot edges
  if (effectiveSide === 'left' && cx - boxWidth - 10 < plotX + edgePad) {
    effectiveSide = 'right';
  } else if (effectiveSide === 'right' && cx + 10 + boxWidth > plotRight - edgePad) {
    effectiveSide = 'left';
  }

  let x = cx - boxWidth / 2;
  let y = cy - 30 + offsetY;

  if (effectiveSide === 'left') {
    x = cx - boxWidth - 10;
    y = cy - boxHeight / 2 + offsetY;
  } else if (effectiveSide === 'right') {
    x = cx + 10;
    y = cy - boxHeight / 2 + offsetY;
  } else if (effectiveSide === 'bottom') {
    x = cx - boxWidth / 2;
    y = cy + 10 + offsetY;
  }

  const minX = plotX + edgePad;
  const minY = plotY + edgePad;
  const maxX = plotRight - boxWidth - edgePad;
  const maxY = plotBottom - boxHeight - edgePad;

  const hasPlot = plotW > 0 && plotH > 0;
  if (hasPlot) {
    x = Math.min(Math.max(minX, x), Number.isFinite(maxX) ? maxX : x);
    y = Math.min(Math.max(minY, y), Number.isFinite(maxY) ? maxY : y);
  }

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
    const n = data.length;
    // Keep callouts inside the chart: never hang labels off the left edge; bias last points leftward.
    let side = 'top';
    if (isHigh) {
      side = 'top';
    } else if (n <= 1) {
      side = 'top';
    } else if (positionIndex === 0) {
      side = 'right';
    } else if (positionIndex >= Math.ceil(n * 0.72)) {
      side = 'left';
    } else {
      side = 'right';
    }

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

  // Generous margins so ReferenceDot labels and month ticks are not clipped (Recharts SVG overflow is hidden).
  const chartMargin = {
    top: 42,
    right: isSmallScreen ? 22 : 40,
    left: isSmallScreen ? 22 : 36,
    bottom: isSmallScreen ? 54 : 36,
  };

  return (
    <ResponsiveContainer width="100%" height="100%" className="trendLineChartContainer">
      <LineChart data={data} margin={chartMargin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis
          dataKey={xDataKey}
          tickFormatter={isSmallScreen ? formatTrendXAxisLabelCompact : formatTrendXAxisLabel}
          tick={{
            fill: '#94a3b8',
            fontSize: isSmallScreen ? 11 : 12,
            angle: isSmallScreen ? -35 : 0,
            textAnchor: isSmallScreen ? 'end' : 'middle',
          }}
          height={isSmallScreen ? 46 : undefined}
          tickMargin={isSmallScreen ? 10 : 12}
          interval={isSmallScreen ? 'preserveStartEnd' : data.length <= 24 ? 0 : 'preserveStartEnd'}
          minTickGap={isSmallScreen ? 26 : data.length <= 24 ? 2 : 28}
        />
        <YAxis
          domain={yDomain}
          tick={isSmallScreen ? false : { fill: '#94a3b8', fontSize: 12 }}
          tickLine={!isSmallScreen}
          tickFormatter={
            isSmallScreen ? undefined : (value) => formatMaybeHidden(hideValues, formatForTooltip, Number(value) || 0, '')
          }
          width={isSmallScreen ? 4 : 120}
          tickMargin={isSmallScreen ? 0 : 8}
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
