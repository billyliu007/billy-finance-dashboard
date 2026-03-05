import {
  formatMaybeHidden,
  formatMoney,
  formatPercent,
  formatPercentUnsigned,
  formatQty,
} from '../../utils/formatters';

export default function PortfolioPositionsTable({ hideValues, rows }) {
  return (
    <article className="tableCard">
      <h2>Positions</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Asset Type</th>
              <th>Quantity</th>
              <th>Avg Cost per Unit</th>
              <th>Cost Basis</th>
              <th>Market Price</th>
              <th>Market Value</th>
              <th>Portfolio Weight (%)</th>
              <th>Unrealized Gain/Loss</th>
              <th>Unrealized Return (%)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.key}>
                <td>{item.name}</td>
                <td>{item.category}</td>
                <td>{formatMaybeHidden(hideValues, formatQty, item.qty)}</td>
                <td>{formatMaybeHidden(hideValues, formatMoney, item.purchasePrice)}</td>
                <td>{formatMaybeHidden(hideValues, formatMoney, item.totalPurchaseCost)}</td>
                <td>{formatMaybeHidden(hideValues, formatMoney, item.currentPrice)}</td>
                <td>{formatMaybeHidden(hideValues, formatMoney, item.currentValue)}</td>
                <td>{formatPercentUnsigned(item.weightPct)}</td>
                <td className={item.pnl >= 0 ? 'pos' : 'neg'}>{formatMaybeHidden(hideValues, formatMoney, item.pnl)}</td>
                <td className={item.pnl >= 0 ? 'pos' : 'neg'}>{formatPercent(item.pnlPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
