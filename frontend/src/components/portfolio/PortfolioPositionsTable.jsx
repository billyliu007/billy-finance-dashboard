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
        <table className="positionsMobileCompact">
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
                <td data-label="Asset">{item.name}</td>
                <td data-label="Asset Type">{item.category}</td>
                <td data-label="Quantity">{formatMaybeHidden(hideValues, formatQty, item.qty)}</td>
                <td data-label="Avg Cost per Unit">{formatMaybeHidden(hideValues, formatMoney, item.purchasePrice)}</td>
                <td data-label="Cost Basis">{formatMaybeHidden(hideValues, formatMoney, item.totalPurchaseCost)}</td>
                <td data-label="Market Price">{formatMaybeHidden(hideValues, formatMoney, item.currentPrice)}</td>
                <td data-label="Market Value">{formatMaybeHidden(hideValues, formatMoney, item.currentValue)}</td>
                <td data-label="Portfolio Weight (%)">{formatPercentUnsigned(item.weightPct)}</td>
                <td data-label="Unrealized Gain/Loss" className={item.pnl >= 0 ? 'pos' : 'neg'}>
                  {formatMaybeHidden(hideValues, formatMoney, item.pnl)}
                </td>
                <td data-label="Unrealized Return (%)" className={item.pnl >= 0 ? 'pos' : 'neg'}>
                  {formatPercent(item.pnlPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
