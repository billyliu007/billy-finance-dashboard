import { formatCny, formatCurrencyValue, formatFxRate, formatMaybeHidden } from '../../utils/formatters';

export default function CashTableCard({ hideValues, rows }) {
  if (!rows.length) {
    return null;
  }

  return (
    <article className="tableCard">
      <h2>Cash & Cash Debt</h2>
      <div className="tableWrap">
        <table>
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
                <td>{item.category}</td>
                <td>{item.name}</td>
                <td>{item.currency}</td>
                <td className={item.value >= 0 ? 'pos' : 'neg'}>
                  {formatMaybeHidden(hideValues, (v) => formatCurrencyValue(v, item.currency), item.value)}
                </td>
                <td>
                  {item.fxRate == null
                    ? 'Rate missing'
                    : formatMaybeHidden(hideValues, formatFxRate, item.fxRate)}
                </td>
                <td className={item.cnyValue == null ? '' : item.cnyValue >= 0 ? 'pos' : 'neg'}>
                  {item.cnyValue == null
                    ? 'Rate missing'
                    : formatMaybeHidden(hideValues, formatCny, item.cnyValue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
