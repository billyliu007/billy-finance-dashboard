import { useState } from 'react';
import KpiIcon from '../KpiIcon.jsx';
import { formatBaseCurrency, formatMaybeHidden, formatPercent } from '../../utils/formatters.js';
import useApiData from '../../hooks/useApiData.js';
import { patchJson } from '../../utils/api.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

function renderKpiName(name, t) {
  const fullMatch = String(name).match(/^([A-Z]{3}) Assets Total \(As in ([A-Z]{3})\)$/);
  if (fullMatch) {
    const currency = fullMatch[1];
    const base = fullMatch[2];
    return (
      <>
        <span>{t('netWorth.assetsTotal', { currency })}</span>
        <span className="kpiNameSuffix"> {t('netWorth.asIn', { currency: base })}</span>
      </>
    );
  }

  const simpleAssetsMatch = String(name).match(/^([A-Z]{3}) Assets Total$/);
  if (simpleAssetsMatch) {
    return t('netWorth.assetsTotal', { currency: simpleAssetsMatch[1] });
  }

  const match = String(name).match(/^(.+?)\s+\(As in ([A-Z]{3})\)$/);
  if (!match) return name;

  const firstRaw = match[1].trim();
  const suffixCurrency = match[2];

  const firstAssetsMatch = firstRaw.match(/^([A-Z]{3}) Assets Total$/);
  const firstLabel = firstAssetsMatch ? t('netWorth.assetsTotal', { currency: firstAssetsMatch[1] }) : firstRaw;

  return (
    <>
      <span>{firstLabel}</span>
      <span className="kpiNameSuffix"> {t('netWorth.asIn', { currency: suffixCurrency })}</span>
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
  const { t } = useLanguage();
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
        <span>{t('netWorth.totalNetWorth')}</span>
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
            {t('netWorth.vsAth')}: {formatPercent(netWorthBounds.pctToAth)}
          </span>
          <span className={`kpiDeltaItem ${netWorthBounds.pctToAtl >= 0 ? 'pos' : 'neg'}`}>
            <KpiIcon type="atl" />
            {t('netWorth.vsAtl')}: {formatPercent(netWorthBounds.pctToAtl)}
          </span>
        </div>
      )}

      <ul className="kpiBreakdown">
        {componentValues.map((component) => (
          <li key={component.key}>
            <span className="kpiName">{renderKpiName(component.name, t)}</span>
            <strong className={component.value >= 0 ? 'pos' : 'neg'}>
              {component.found ? formatMaybeHidden(hideValues, formatValue, component.value) : t('netWorth.notFound')}
            </strong>
          </li>
        ))}
      </ul>

      {missingInputs.length > 0 && <p className="kpiSource">{t('netWorth.missingInputs')}: {missingInputs.join(', ')}</p>}
    </div>
  );
}
