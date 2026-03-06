import { useMemo, useState } from 'react';
import {
  formatMaybeHidden,
  formatMoney,
  formatPercent,
  formatPercentUnsigned,
  formatQty,
} from '../../utils/formatters';

export default function PortfolioPositionsTable({ hideValues, rows }) {
  const [showMobileDetails, setShowMobileDetails] = useState(true);
  const groupedRows = useMemo(() => {
    const grouped = new Map();
    rows.forEach((item) => {
      const classKey = item.category || 'Other';
      if (!grouped.has(classKey)) {
        grouped.set(classKey, []);
      }
      grouped.get(classKey).push(item);
    });
    return Array.from(grouped.entries());
  }, [rows]);

  return (
    <>
      <article className="tableCard portfolioPositionsCard">
        <h2>Positions</h2>
        <div className="tableWrap">
          <table className="positionsMobileCompact">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Asset Class</th>
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
                  <td data-label="Asset Class">{item.category}</td>
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

      <article className="tableCard portfolioMobileDetailsCard">
        <div className="detailsHeaderRow">
          <h2>Positions</h2>
          <button
            type="button"
            className="detailsToggleBtn"
            onClick={() => setShowMobileDetails((prev) => !prev)}
            aria-expanded={showMobileDetails}
          >
            {showMobileDetails ? 'Hide details' : 'Show details'}
            <span className={`detailsChevron ${showMobileDetails ? 'isOpen' : ''}`} aria-hidden="true">
              ▾
            </span>
          </button>
        </div>

        {showMobileDetails && (
          <div className="positionCardStack">
            {groupedRows.map(([assetClass, classRows]) => (
              <section key={`group-${assetClass}`} className="positionClassGroup">
                <header className="positionClassHeader">
                  <h3>{assetClass}</h3>
                  <span>{classRows.length} holdings</span>
                </header>
                <div className="positionClassCards">
                  {classRows.map((item) => (
                    <section key={`mobile-${item.key}`} className="positionDetailCard">
                      <header>
                        <div className="positionNameCol">
                          <h3>{item.name}</h3>
                          <span className="positionMarketPrice">
                            Mkt {formatMaybeHidden(hideValues, formatMoney, item.currentPrice)}
                          </span>
                        </div>
                        <div className={`positionPnlDock ${item.pnl >= 0 ? 'pos' : 'neg'}`}>
                          <strong>{formatMaybeHidden(hideValues, formatMoney, item.pnl)}</strong>
                          <span>{formatMaybeHidden(hideValues, formatPercent, item.pnlPct)}</span>
                        </div>
                      </header>
                      <div className="positionQuickGrid">
                        <div className="positionQuickItem">
                          <span>Market Value</span>
                          <strong>{formatMaybeHidden(hideValues, formatMoney, item.currentValue)}</strong>
                        </div>
                        <div className="positionQuickItem">
                          <span>Cost Basis</span>
                          <strong>{formatMaybeHidden(hideValues, formatMoney, item.totalPurchaseCost)}</strong>
                        </div>
                        <div className="positionQuickItem">
                          <span>Quantity</span>
                          <strong>{formatMaybeHidden(hideValues, formatQty, item.qty)}</strong>
                        </div>
                        <div className="positionQuickItem">
                          <span>Avg Cost</span>
                          <strong>{formatMaybeHidden(hideValues, formatMoney, item.purchasePrice)}</strong>
                        </div>
                      </div>
                      <dl className="positionMetaList">
                        <div>
                          <dt>Weight</dt>
                          <dd>{formatPercentUnsigned(item.weightPct)}</dd>
                        </div>
                      </dl>
                    </section>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </article>
    </>
  );
}
