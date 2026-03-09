import KpiIcon from '../KpiIcon.jsx';
import { formatCny, formatLocalDateTime, formatMaybeHidden, formatPercent } from '../../utils/formatters.js';

export default function PerformanceKpis({ hideValues, summary }) {
  return (
    <div className="kpiRow">
      <article className="miniKpi">
        <p>
          <KpiIcon type="latest" />
          <span>Latest Net Worth Snapshot</span>
        </p>
        <h3>{formatMaybeHidden(hideValues, formatCny, summary.latest.netWorth)}</h3>
        <small>
          {formatLocalDateTime(summary.latest.dateTimeLabel || summary.latest.recordedAtUtc || summary.latest.date, {
            includeSeconds: false,
          })}
        </small>
      </article>
      <article className="miniKpi">
        <p>
          <KpiIcon type="period" />
          <span>Latest Period Return</span>
        </p>
        <h3 className={summary.latestPeriodChangePct >= 0 ? 'pos' : 'neg'}>{formatPercent(summary.latestPeriodChangePct)}</h3>
        <small>
          {summary.latestPeriodStart
            ? `${formatLocalDateTime(summary.latestPeriodStart, { includeSeconds: false })} -> ${formatLocalDateTime(summary.latestPeriodEnd, { includeSeconds: false })}`
            : formatLocalDateTime(summary.latestPeriodEnd || summary.latestPeriodSubtitle, { includeSeconds: false })}
        </small>
      </article>
      <article className="miniKpi">
        <p>
          <KpiIcon type="peak" />
          <span>All-Time High Net Worth</span>
        </p>
        <h3 className="pos">{formatMaybeHidden(hideValues, formatCny, summary.peak.netWorth)}</h3>
        <small>
          {formatLocalDateTime(summary.peak.dateTimeLabel || summary.peak.recordedAtUtc || summary.peak.date, {
            includeSeconds: false,
          })}
        </small>
      </article>
      <article className="miniKpi">
        <p>
          <KpiIcon type="atl" />
          <span>All-Time Low Net Worth</span>
        </p>
        <h3 className="neg">{formatMaybeHidden(hideValues, formatCny, summary.bottom.netWorth)}</h3>
        <small>
          {formatLocalDateTime(summary.bottom.dateTimeLabel || summary.bottom.recordedAtUtc || summary.bottom.date, {
            includeSeconds: false,
          })}
        </small>
      </article>
    </div>
  );
}
