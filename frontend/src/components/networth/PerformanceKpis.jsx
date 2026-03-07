import KpiIcon from '../KpiIcon.jsx';
import { formatCny, formatMaybeHidden, formatPercent } from '../../utils/formatters.js';

export default function PerformanceKpis({ hideValues, summary }) {
  return (
    <div className="kpiRow">
      <article className="miniKpi">
        <p>
          <KpiIcon type="latest" />
          <span>Latest Net Worth Snapshot</span>
        </p>
        <h3>{formatMaybeHidden(hideValues, formatCny, summary.latest.netWorth)}</h3>
        <small>{summary.latest.date}</small>
      </article>
      <article className="miniKpi">
        <p>
          <KpiIcon type="period" />
          <span>Month-over-Month Return</span>
        </p>
        <h3 className={summary.latestPeriodChangePct >= 0 ? 'pos' : 'neg'}>{formatPercent(summary.latestPeriodChangePct)}</h3>
        <small>{summary.latestPeriodSubtitle}</small>
      </article>
      <article className="miniKpi">
        <p>
          <KpiIcon type="peak" />
          <span>All-Time High Net Worth</span>
        </p>
        <h3 className="pos">{formatMaybeHidden(hideValues, formatCny, summary.peak.netWorth)}</h3>
        <small>{summary.peak.date}</small>
      </article>
      <article className="miniKpi">
        <p>
          <KpiIcon type="atl" />
          <span>All-Time Low Net Worth</span>
        </p>
        <h3 className="neg">{formatMaybeHidden(hideValues, formatCny, summary.bottom.netWorth)}</h3>
        <small>{summary.bottom.date}</small>
      </article>
    </div>
  );
}
