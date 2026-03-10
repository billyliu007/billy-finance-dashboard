import { useEffect, useState } from 'react';
import { formatBaseCurrency, formatCurrencyValue, formatFxRate, formatMaybeHidden } from '../../utils/formatters.js';

export default function CashTableCard({
  hideValues,
  rows,
  baseCurrency = 'USD',
  onAdd,
  onEdit,
  onDelete,
}) {
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

  const hasActions = Boolean(onAdd || onEdit || onDelete);

  if (!rows.length && !onAdd) {
    return null;
  }

  return (
    <article className="tableCard">
      <div className="tableHeaderRow">
        <h2>Cash & Cash Debt</h2>
        <div className="tableHeaderActions">
          {onAdd && (
            <button
              type="button"
              className="headerIconBtn addMenuToggle"
              onClick={() => setShowAddMenu((prev) => !prev)}
              aria-label="Add cash"
              aria-expanded={showAddMenu}
            >
              +
            </button>
          )}
          {showAddMenu && onAdd && (
            <div className="addMenuPopover">
              <button type="button" onClick={() => { setShowAddMenu(false); onAdd(); }}>
                Add cash / debt
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="tableWrap">
        <table className="cashMobileCompact">
          <thead>
            <tr>
              <th>Type</th>
              <th>Name</th>
              <th>Currency</th>
              <th>Balance (Local)</th>
              <th>FX Rate (to CNY)</th>
              <th>Balance ({baseCurrency})</th>
              {hasActions && <th className="positionActionsHeader">Actions</th>}
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
                <td data-label={`Balance (${baseCurrency})`} className={item.amountCnyClass}>
                  {item.amountCny == null
                    ? 'Rate missing'
                    : formatMaybeHidden(hideValues, (v) => formatBaseCurrency(v, baseCurrency), item.amountCny)}
                </td>
                {hasActions && (
                  <td data-label="Actions" className="positionActionsCell">
                    {onEdit && (
                      <button
                        type="button"
                        className="headerIconBtn positionActionBtn"
                        onClick={() => onEdit(item)}
                        aria-label={`Edit ${item.instrument}`}
                        title="Edit"
                      >
                        ✎
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        className="headerIconBtn positionActionBtn positionActionBtnDanger"
                        onClick={() => onDelete(item)}
                        aria-label={`Delete ${item.instrument}`}
                        title="Delete"
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
  );
}
