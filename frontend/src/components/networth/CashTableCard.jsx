import { formatCny, formatCurrencyValue, formatFxRate, formatMaybeHidden } from '../../utils/formatters.js';

export default function CashTableCard({ hideValues, rows }) {
  if (!rows.length) {
    return null;
  }

  return (
    <article className="tableCard">
      <h2>Cash & Cash Debt</h2>
      <div className="tableWrap">
        <table className="cashMobileCompact">
          <thead>
            <tr>
              <th>Type</th>
              <th>Name</th>
              <th>Currency</th>
              <th>Balance (Local)</th>
              <th>FX Rate (to CNY)</th>
              <th>Balance (CNY)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.key}>
                <td data-label="Type">{item.className}</td>
                <td data-label="Name">{item.instrument}</td>
                <td data-label="Currency">{item.currency}</td>
                <td data-label="Balance (Local)" className={item.amountClass}>
                  {formatMaybeHidden(hideValues, (v) => formatCurrencyValue(v, item.currency), item.amountLocal)}
                </td>
                <td data-label="FX Rate (to CNY)">
                  {item.fxRate == null
                    ? 'Rate missing'
                    : formatMaybeHidden(hideValues, formatFxRate, item.fxRate)}
                </td>
                <td data-label="Balance (CNY)" className={item.amountCnyClass}>
                  {item.amountCny == null
                    ? 'Rate missing'
                    : formatMaybeHidden(hideValues, formatCny, item.amountCny)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
