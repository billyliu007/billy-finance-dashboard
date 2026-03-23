import { useLanguage } from '../contexts/LanguageContext.jsx';
import { formatCurrencyValue, formatPercent } from '../utils/formatters.js';

function formatValByCurrency(hideValues, v, currency) {
  if (hideValues) return '—';
  return formatCurrencyValue(Number(v) || 0, currency || 'USD');
}

export default function TradeHistoryTable({ trades, title, hideValues }) {
  const { t } = useLanguage();
  return (
    <div className="profitabilityTableWrap">
      <table className="profitabilityTable profitabilityTable--trades">
        <thead>
          <tr>
            <th colSpan={7}>{title}</th>
          </tr>
          <tr>
            <th>{t('profitability.date')}</th>
            <th>{t('portfolio.asset')}</th>
            <th>{t('profitability.qty')}</th>
            <th>{t('profitability.proceeds')}</th>
            <th>{t('profitability.cost')}</th>
            <th>{t('profitability.pl')}</th>
            <th>{t('profitability.returnPctShort')}</th>
          </tr>
        </thead>
        <tbody>
          {(trades || []).map((tr) => (
            <tr key={`tr-${tr.id}`}>
              <td>{tr.txDate}</td>
              <td>{tr.symbol}</td>
              <td>{hideValues ? '—' : tr.qty}</td>
              <td>{formatValByCurrency(hideValues, tr.proceeds, tr.currency)}</td>
              <td>{formatValByCurrency(hideValues, tr.cost, tr.currency)}</td>
              <td className={tr.pnl >= 0 ? 'pos' : 'neg'}>{formatValByCurrency(hideValues, tr.pnl, tr.currency)}</td>
              <td>{hideValues ? '—' : tr.returnPct == null ? '—' : formatPercent(tr.returnPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
