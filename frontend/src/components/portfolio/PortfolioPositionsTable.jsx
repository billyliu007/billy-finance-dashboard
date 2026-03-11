import { useEffect, useMemo, useState } from 'react';
import {
  formatMaybeHidden,
  formatMoney,
  formatPercent,
  formatPercentUnsigned,
  formatQty,
} from '../../utils/formatters.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

export default function PortfolioPositionsTable({
  hideValues,
  rows,
  onAddCrypto,
  onAddStock,
  onEditPosition,
  onDeletePosition,
}) {
  const { t } = useLanguage();
  const [showMobileDetails, setShowMobileDetails] = useState(true);
  const [showAddMenu, setShowAddMenu] = useState(false);

  useEffect(() => {
    if (!showAddMenu) return;
    function handleClickOutside(event) {
      if (event.target.closest('.addMenuToggle, .addMenuPopover')) return;
      setShowAddMenu(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAddMenu]);

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
        <div className="tableHeaderRow">
          <h2>{t('portfolio.positions')}</h2>
          <div className="tableHeaderActions">
            {(onAddStock || onAddCrypto) && (
              <>
                <button
                  type="button"
                  className="headerIconBtn addMenuToggle"
                  onClick={() => setShowAddMenu((prev) => !prev)}
                  aria-label={t('portfolio.addPosition')}
                  aria-expanded={showAddMenu}
                >
                  +
                </button>
                {showAddMenu && (
                  <div className="addMenuPopover">
                    {onAddStock && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddMenu(false);
                          onAddStock();
                        }}
                      >
                        {t('portfolio.stockPosition')}
                      </button>
                    )}
                    {onAddCrypto && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddMenu(false);
                          onAddCrypto();
                        }}
                      >
                        {t('portfolio.cryptoPosition')}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <div className="tableWrap">
          <table className="positionsMobileCompact">
            <thead>
              <tr>
                <th>{t('portfolio.asset')}</th>
                <th>{t('portfolio.assetClass')}</th>
                <th>{t('portfolio.quantity')}</th>
                <th>{t('portfolio.avgCostPerUnit')}</th>
                <th>{t('portfolio.costBasis')}</th>
                <th>{t('portfolio.marketPrice')}</th>
                <th>{t('portfolio.marketValue')}</th>
                <th>{t('portfolio.portfolioWeight')}</th>
                <th>{t('portfolio.unrealizedGainLoss')}</th>
                <th>{t('portfolio.unrealizedReturn')}</th>
                {(onEditPosition || onDeletePosition) && <th className="positionActionsHeader">{t('netWorth.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.key}>
                  <td data-label={t('portfolio.asset')}>{item.name}</td>
                  <td data-label={t('portfolio.assetClass')}>{item.category}</td>
                  <td data-label={t('portfolio.quantity')}>{formatMaybeHidden(hideValues, formatQty, item.qty)}</td>
                  <td data-label={t('portfolio.avgCostPerUnit')}>{formatMaybeHidden(hideValues, formatMoney, item.purchasePrice)}</td>
                  <td data-label={t('portfolio.costBasis')}>{formatMaybeHidden(hideValues, formatMoney, item.totalPurchaseCost)}</td>
                  <td data-label={t('portfolio.marketPrice')}>{formatMaybeHidden(hideValues, formatMoney, item.currentPrice)}</td>
                  <td data-label={t('portfolio.marketValue')}>{formatMaybeHidden(hideValues, formatMoney, item.currentValue)}</td>
                  <td data-label={t('portfolio.portfolioWeight')}>{formatPercentUnsigned(item.weightPct)}</td>
                  <td data-label={t('portfolio.unrealizedGainLoss')} className={item.pnl >= 0 ? 'pos' : 'neg'}>
                    {formatMaybeHidden(hideValues, formatMoney, item.pnl)}
                  </td>
                  <td data-label={t('portfolio.unrealizedReturn')} className={item.pnl >= 0 ? 'pos' : 'neg'}>
                    {formatPercent(item.pnlPct)}
                  </td>
                  {(onEditPosition || onDeletePosition) && (
                    <td data-label={t('netWorth.actions')} className="positionActionsCell">
                      {onEditPosition && (
                        <button
                          type="button"
                          className="headerIconBtn positionActionBtn"
                          onClick={() => onEditPosition(item)}
                          aria-label={`${t('portfolio.edit')} ${item.name}`}
                          title={t('portfolio.edit')}
                        >
                          ✎
                        </button>
                      )}
                      {onDeletePosition && (
                        <button
                          type="button"
                          className="headerIconBtn positionActionBtn positionActionBtnDanger"
                          onClick={() => onDeletePosition(item)}
                          aria-label={`${t('portfolio.delete')} ${item.name}`}
                          title={t('portfolio.delete')}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="tableCard portfolioMobileDetailsCard">
        <div className="detailsHeaderRow">
          <h2>{t('portfolio.positions')}</h2>
          <div className="detailsHeaderActions">
            {(onAddStock || onAddCrypto) && (
              <>
                <button
                  type="button"
                  className="headerIconBtn addMenuToggle"
                  onClick={() => setShowAddMenu((prev) => !prev)}
                  aria-label={t('portfolio.addPosition')}
                  aria-expanded={showAddMenu}
                >
                  +
                </button>
                {showAddMenu && (
                  <div className="addMenuPopover">
                    {onAddStock && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddMenu(false);
                          onAddStock();
                        }}
                      >
                        {t('portfolio.stockPosition')}
                      </button>
                    )}
                    {onAddCrypto && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddMenu(false);
                          onAddCrypto();
                        }}
                      >
                        {t('portfolio.cryptoPosition')}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
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
                        <div className="positionMetaRowWithActions">
                          <div>
                            <dt>Weight</dt>
                            <dd>{formatPercentUnsigned(item.weightPct)}</dd>
                          </div>
                          {(onEditPosition || onDeletePosition) && (
                            <div className="positionCardActionIcons">
                              {onEditPosition && (
                                <button
                                  type="button"
                                  className="headerIconBtn positionActionBtn"
                                  onClick={() => onEditPosition(item)}
                                  aria-label={`Edit ${item.name}`}
                                  title="Edit"
                                >
                                  ✎
                                </button>
                              )}
                              {onDeletePosition && (
                                <button
                                  type="button"
                                  className="headerIconBtn positionActionBtn positionActionBtnDanger"
                                  onClick={() => onDeletePosition(item)}
                                  aria-label={`Delete ${item.name}`}
                                  title="Delete"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          )}
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
