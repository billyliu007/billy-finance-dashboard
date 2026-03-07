import KpiIcon from '../KpiIcon.jsx';
import { formatCny, formatMaybeHidden, formatPercent } from '../../utils/formatters.js';

function renderKpiName(name) {
  const suffix = ' (As in CNY)';
  if (!String(name).endsWith(suffix)) {
    return name;
  }

  const base = name.slice(0, -suffix.length);
  return (
    <>
      <span>{base}</span>
      <span className="kpiNameSuffix">{suffix}</span>
    </>
  );
}

export default function NetWorthSummaryCard({
  hideValues,
  totalNetWorth,
  netWorthBounds,
  componentValues,
  missingInputs,
}) {
  return (
    <div className="kpiCard">
      <p className="kpiLabel">
        <KpiIcon type="networth" />
        <span>Total Net Worth</span>
      </p>
      <p className={`kpiValue ${totalNetWorth >= 0 ? 'pos' : 'neg'}`}>
        {formatMaybeHidden(hideValues, formatCny, totalNetWorth)}
      </p>
      {netWorthBounds && (
        <div className="kpiDeltaRow">
          <span className={`kpiDeltaItem ${netWorthBounds.pctToAth >= 0 ? 'pos' : 'neg'}`}>
            <KpiIcon type="ath" />
            vs All-Time High: {formatPercent(netWorthBounds.pctToAth)}
          </span>
          <span className={`kpiDeltaItem ${netWorthBounds.pctToAtl >= 0 ? 'pos' : 'neg'}`}>
            <KpiIcon type="atl" />
            vs All-Time Low: {formatPercent(netWorthBounds.pctToAtl)}
          </span>
        </div>
      )}

      <ul className="kpiBreakdown">
        {componentValues.map((component) => (
          <li key={component.key}>
            <span className="kpiName">{renderKpiName(component.name)}</span>
            <strong className={component.value >= 0 ? 'pos' : 'neg'}>
              {component.found ? formatMaybeHidden(hideValues, formatCny, component.value) : 'Not found'}
            </strong>
          </li>
        ))}
      </ul>

      {missingInputs.length > 0 && <p className="kpiSource">Missing inputs: {missingInputs.join(', ')}</p>}
    </div>
  );
}
