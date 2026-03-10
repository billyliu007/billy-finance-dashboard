import { useState } from 'react';
import KpiIcon from '../KpiIcon.jsx';
import { formatBaseCurrency, formatMaybeHidden, formatPercent } from '../../utils/formatters.js';
import useApiData from '../../hooks/useApiData.js';
import { patchJson } from '../../utils/api.js';

function renderKpiName(name) {
  const match = String(name).match(/^(.+?)\s+\((As in [A-Z]{3})\)$/);
  if (!match) {
    return name;
  }
  return (
    <>
      <span>{match[1].trim()}</span>
      <span className="kpiNameSuffix"> {match[2]}</span>
    </>
  );
}

export default function NetWorthSummaryCard({
  hideValues,
  totalNetWorth,
  netWorthBounds,
  componentValues,
  missingInputs,
  baseCurrency = 'USD',
  onBaseCurrencyChange,
}) {
  const { data: currenciesData } = useApiData('/api/currencies', { refreshMs: 0 });
  const currencies = currenciesData?.currencies ?? [];
  const [isSavingPref, setIsSavingPref] = useState(false);

  async function handleBaseCurrencyChange(event) {
    const code = event?.target?.value;
    if (!code || code === baseCurrency || !onBaseCurrencyChange) return;
    try {
      setIsSavingPref(true);
      await patchJson('/api/user/preferences', { baseCurrency: code });
      onBaseCurrencyChange?.(code);
    } finally {
      setIsSavingPref(false);
    }
  }

  const formatValue = (v) => formatBaseCurrency(v, baseCurrency);

  return (
    <div className="kpiCard">
      <p className="kpiLabel">
        <KpiIcon type="networth" />
        <span>Total Net Worth</span>
      </p>
      <div className="kpiValueRow">
        <p className={`kpiValue ${totalNetWorth >= 0 ? 'pos' : 'neg'}`}>
          {formatMaybeHidden(hideValues, formatValue, totalNetWorth)}
        </p>
        {currencies.length > 0 && (
          <select
            className="kpiBaseCurrencySelect"
            value={baseCurrency}
            onChange={handleBaseCurrencyChange}
            disabled={isSavingPref}
            aria-label="Base currency"
          >
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        )}
      </div>
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
              {component.found ? formatMaybeHidden(hideValues, formatValue, component.value) : 'Not found'}
            </strong>
          </li>
        ))}
      </ul>

      {missingInputs.length > 0 && <p className="kpiSource">Missing inputs: {missingInputs.join(', ')}</p>}
    </div>
  );
}
