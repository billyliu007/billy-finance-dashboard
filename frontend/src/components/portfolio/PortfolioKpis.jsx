import { formatMaybeHidden, formatMoney, formatPercent } from '../../utils/formatters.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

export default function PortfolioKpis({ hideValues, totals, totalPnlPct }) {
  const { t } = useLanguage();
  return (
    <div className="kpiRow">
      <article className="miniKpi">
        <p>{t('portfolio.totalUnrealizedPl')}</p>
        <h3 className={totals.pnl >= 0 ? 'pos' : 'neg'}>{formatMaybeHidden(hideValues, formatMoney, totals.pnl)}</h3>
        <small className={totals.pnl >= 0 ? 'pos' : 'neg'}>{formatPercent(totalPnlPct)}</small>
      </article>
      <article className="miniKpi">
        <p>{t('portfolio.totalRealizedPl')}</p>
        <h3 className={(Number(totals.realizedPnl) || 0) >= 0 ? 'pos' : 'neg'}>
          {formatMaybeHidden(hideValues, formatMoney, Number(totals.realizedPnl) || 0)}
        </h3>
      </article>
      <article className="miniKpi">
        <p>{t('portfolio.totalMarketValue')}</p>
        <h3>{formatMaybeHidden(hideValues, formatMoney, totals.value)}</h3>
      </article>
      <article className="miniKpi">
        <p>{t('portfolio.totalCostBasis')}</p>
        <h3>{formatMaybeHidden(hideValues, formatMoney, totals.cost)}</h3>
      </article>
    </div>
  );
}
