import { formatCny, formatCurrencyValue, formatFxRate, formatMaybeHidden } from '../../utils/formatters';

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
              <th>Class</th>
              <th>Instrument</th>
              <th>CCY</th>
              <th>Amount (Local)</th>
              <th>FX Rate (to CNY)</th>
              <th>Amount (CNY)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.key}>
                <td data-label="Class">{item.className}</td>
                <td data-label="Instrument">{item.instrument}</td>
                <td data-label="CCY">{item.currency}</td>
                <td data-label="Amount (Local)" className={item.amountClass}>
                  {formatMaybeHidden(hideValues, (v) => formatCurrencyValue(v, item.currency), item.amountLocal)}
                </td>
                <td data-label="FX Rate (to CNY)">
                  {item.fxRate == null
                    ? 'Rate missing'
                    : formatMaybeHidden(hideValues, formatFxRate, item.fxRate)}
                </td>
                <td data-label="Amount (CNY)" className={item.amountCnyClass}>
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
