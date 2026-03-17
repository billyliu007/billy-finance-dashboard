import { useEffect, useMemo, useState } from 'react';
import {
  formatMaybeHidden,
  formatMoney,
  formatPercent,
  formatPercentUnsigned,
  formatQty,
} from '../../utils/formatters.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';
import { deleteJson, fetchJson } from '../../utils/api.js';
import RecordPurchaseModal from './RecordPurchaseModal.jsx';

export default function PortfolioPositionsTable({
  hideValues,
  rows,
  onAddCrypto,
  onAddStock,
  onEditPosition,
  onDeletePosition,
  cashComponents,
  onRefresh,
}) {
  const { t } = useLanguage();
  const [showMobileDetails] = useState(true);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [txBySymbol, setTxBySymbol] = useState(() => new Map());
  const [txLoadingBySymbol, setTxLoadingBySymbol] = useState(() => new Map());
  const [txErrorBySymbol, setTxErrorBySymbol] = useState(() => new Map());
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [recordPosition, setRecordPosition] = useState(null);

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

  /** Display label for asset class. "Stock Assets" (legacy) → "US Stock Assets"; others shown as-is for future classes. */
  const getAssetClassDisplayLabel = (category) => {
    if (category === 'Stock Assets' || category === 'US Stock Assets') return 'US Stock Assets';
    return category || 'Other';
  };

  const tableHeaderRow = (
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
  );

  const priceUnavailable = (item) => (item.currentPrice === 0 && item.priceSource === 'unavailable');
  const formatPrice = (item, value) =>
    !hideValues && priceUnavailable(item) && value === 0 ? '—' : formatMaybeHidden(hideValues, formatMoney, value);

  async function loadTransactionsFor(symbol) {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return;
    setTxLoadingBySymbol((prev) => new Map(prev).set(sym, true));
    setTxErrorBySymbol((prev) => {
      const next = new Map(prev);
      next.delete(sym);
      return next;
    });
    try {
      const res = await fetchJson(`/api/portfolio/positions/${encodeURIComponent(sym)}/transactions`);
      const list = Array.isArray(res?.transactions) ? res.transactions : [];
      setTxBySymbol((prev) => new Map(prev).set(sym, list));
    } catch (err) {
      setTxErrorBySymbol((prev) => new Map(prev).set(sym, err?.message || 'Failed to load transactions.'));
    } finally {
      setTxLoadingBySymbol((prev) => new Map(prev).set(sym, false));
    }
  }

  function toggleExpanded(item) {
    const sym = String(item?.symbol || item?.key || '').trim().toUpperCase();
    if (!sym) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      return next;
    });
    if (!txBySymbol.has(sym)) {
      loadTransactionsFor(sym);
    }
  }

  async function handleDeleteTx(symbol, txId) {
    const sym = String(symbol || '').trim().toUpperCase();
    const id = String(txId || '').trim();
    if (!sym || !id) return;
    if (!window.confirm('Delete this transaction? This cannot be undone.')) return;
    try {
      await deleteJson(`/api/portfolio/transactions/${encodeURIComponent(id)}`);
      await loadTransactionsFor(sym);
      onRefresh?.();
    } catch (err) {
      window.alert(err?.message || 'Failed to delete transaction.');
    }
  }

  function openRecordPurchase(item) {
    setRecordPosition(item);
    setRecordModalOpen(true);
  }

  const renderPositionRow = (item) => (
    <>
      <tr key={item.key}>
        <td data-label={t('portfolio.asset')}>
          <button
            type="button"
            className="headerIconBtn positionExpandBtn"
            onClick={() => toggleExpanded(item)}
            aria-label="Toggle transactions"
            title="Show transactions"
          >
            {expanded.has(String(item.symbol || item.key).toUpperCase()) ? '▾' : '▸'}
          </button>
          <span className="positionAssetName">{item.name}</span>
        </td>
      <td data-label={t('portfolio.currency')}>{item.currency || 'USD'}</td>
      <td data-label={t('portfolio.quantity')}>{formatMaybeHidden(hideValues, formatQty, item.qty)}</td>
      <td data-label={t('portfolio.avgCostPerUnit')}>{formatMaybeHidden(hideValues, formatMoney, item.purchasePrice)}</td>
      <td data-label={t('portfolio.costBasis')}>{formatMaybeHidden(hideValues, formatMoney, item.totalPurchaseCost)}</td>
      <td data-label={t('portfolio.marketPrice')}>{formatPrice(item, item.currentPrice)}</td>
      <td data-label={t('portfolio.marketValue')}>{formatPrice(item, item.currentValue)}</td>
      <td data-label={t('portfolio.portfolioWeight')}>{formatPercentUnsigned(item.weightPct)}</td>
      <td data-label={t('portfolio.unrealizedGainLoss')} className={item.pnl >= 0 ? 'pos' : 'neg'}>
        {formatMaybeHidden(hideValues, formatMoney, item.pnl)}
      </td>
      <td data-label={t('portfolio.unrealizedReturn')} className={item.pnl >= 0 ? 'pos' : 'neg'}>
        {formatPercent(item.pnlPct)}
      </td>
      {(onEditPosition || onDeletePosition) && (
        <td data-label={t('netWorth.actions')} className="positionActionsCell">
          <button
            type="button"
            className="headerIconBtn positionActionBtn"
            onClick={() => openRecordPurchase(item)}
            aria-label="Record purchase"
            title="Record purchase"
          >
            +
          </button>
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
      {expanded.has(String(item.symbol || item.key).toUpperCase()) && (
        <tr className="positionTxRow">
          <td colSpan={(onEditPosition || onDeletePosition) ? 11 : 10}>
            <div className="positionTxPanel">
              <div className="positionTxPanelHeader">
                <strong>Transactions</strong>
                <button type="button" className="modalBtn" onClick={() => openRecordPurchase(item)}>
                  Record purchase
                </button>
              </div>
              {txLoadingBySymbol.get(String(item.symbol || item.key).toUpperCase()) && <p>Loading…</p>}
              {txErrorBySymbol.get(String(item.symbol || item.key).toUpperCase()) && (
                <p className="error">{txErrorBySymbol.get(String(item.symbol || item.key).toUpperCase())}</p>
              )}
              {!txLoadingBySymbol.get(String(item.symbol || item.key).toUpperCase()) && (
                <table className="positionTxTable">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Qty</th>
                      <th>Avg Cost</th>
                      <th>Cost</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(txBySymbol.get(String(item.symbol || item.key).toUpperCase()) || []).length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ color: '#94a3b8' }}>
                          No transactions yet.
                        </td>
                      </tr>
                    ) : (
                      (txBySymbol.get(String(item.symbol || item.key).toUpperCase()) || []).map((tx) => (
                        <tr key={tx.id}>
                          <td>{tx.txDate}</td>
                          <td>{formatMaybeHidden(hideValues, formatQty, tx.qty)}</td>
                          <td>{formatMaybeHidden(hideValues, formatMoney, tx.avgCostPerUnit)}</td>
                          <td>{formatMaybeHidden(hideValues, formatMoney, (Number(tx.qty) || 0) * (Number(tx.avgCostPerUnit) || 0))}</td>
                          <td>
                            <button
                              type="button"
                              className="headerIconBtn positionActionBtn positionActionBtnDanger"
                              onClick={() => handleDeleteTx(item.symbol || item.key, tx.id)}
                              aria-label="Delete transaction"
                              title="Delete"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );

  return (
    <>
      <article className="tableCard portfolioPositionsCard">
        {tableHeaderRow}
        <div className="portfolioDesktopTables">
          {groupedRows.map(([assetClass, classRows]) => (
            <section key={`desktop-${assetClass}`} className="portfolioAssetClassTable">
              <h3 className="assetClassTableTitle">{getAssetClassDisplayLabel(assetClass)}</h3>
              <div className="tableWrap">
                <table className="positionsMobileCompact positionsDesktopByClass">
                  <thead>
                    <tr>
                      <th>{t('portfolio.asset')}</th>
                      <th>{t('portfolio.currency')}</th>
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
                    {classRows.map(renderPositionRow)}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      </article>

      <RecordPurchaseModal
        open={recordModalOpen}
        position={recordPosition}
        cashComponents={cashComponents}
        onClose={() => setRecordModalOpen(false)}
        onSaved={async () => {
          if (recordPosition?.symbol) {
            await loadTransactionsFor(recordPosition.symbol);
          }
          onRefresh?.();
        }}
      />

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
                  <h3>{getAssetClassDisplayLabel(assetClass)}</h3>
                  <span>{classRows.length} holdings</span>
                </header>
                <div className="positionClassCards">
                  {classRows.map((item) => (
                    <section key={`mobile-${item.key}`} className="positionDetailCard">
                      <header>
                        <div className="positionNameCol">
                          <h3>{item.name}</h3>
                          <span className="positionMarketMeta">
                            {item.currency || 'USD'} · Mkt {formatPrice(item, item.currentPrice)}
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
                          <strong>{formatPrice(item, item.currentValue)}</strong>
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
