import { formatMaybeHidden, formatMoney, formatPercent } from '../../utils/formatters.js';

export default function PortfolioKpis({ hideValues, totals, totalPnlPct }) {
  return (
    <div className="kpiRow">
      <article className="miniKpi">
        <p>Total Unrealized P/L</p>
        <h3 className={totals.pnl >= 0 ? 'pos' : 'neg'}>{formatMaybeHidden(hideValues, formatMoney, totals.pnl)}</h3>
        <small className={totals.pnl >= 0 ? 'pos' : 'neg'}>{formatPercent(totalPnlPct)}</small>
      </article>
      <article className="miniKpi">
        <p>Total Market Value</p>
        <h3>{formatMaybeHidden(hideValues, formatMoney, totals.value)}</h3>
      </article>
      <article className="miniKpi">
        <p>Total Cost Basis</p>
        <h3>{formatMaybeHidden(hideValues, formatMoney, totals.cost)}</h3>
      </article>
    </div>
  );
}
