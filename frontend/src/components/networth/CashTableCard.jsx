import { useEffect, useState } from 'react';
import { formatBaseCurrency, formatCurrencyValue, formatFxRate, formatMaybeHidden } from '../../utils/formatters.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

export default function CashTableCard({
  hideValues,
  rows,
  baseCurrency = 'USD',
  onAdd,
  onEdit,
  onDelete,
}) {
  const { t } = useLanguage();
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
        <h2>{t('netWorth.cashAndDebt')}</h2>
        <div className="tableHeaderActions">
          {onAdd && (
            <button
              type="button"
              className="headerIconBtn addMenuToggle"
              onClick={() => setShowAddMenu((prev) => !prev)}
              aria-label={t('netWorth.addCashDebt')}
              aria-expanded={showAddMenu}
            >
              +
            </button>
          )}
          {showAddMenu && onAdd && (
            <div className="addMenuPopover">
              <button type="button" onClick={() => { setShowAddMenu(false); onAdd(); }}>
                {t('netWorth.addCashDebt')}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="tableWrap">
        <table className="cashMobileCompact">
          <thead>
            <tr>
              <th>{t('netWorth.type')}</th>
              <th>{t('netWorth.name')}</th>
              <th>{t('netWorth.currency')}</th>
              <th>{t('netWorth.balanceLocal')}</th>
              <th>{t('netWorth.fxRateToCny')}</th>
              <th>{t('netWorth.balanceBase')} ({baseCurrency})</th>
              {hasActions && <th className="positionActionsHeader">{t('netWorth.actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.key}>
                <td data-label={t('netWorth.type')}>{item.className}</td>
                <td data-label={t('netWorth.name')}>{item.instrument}</td>
                <td data-label={t('netWorth.currency')}>{item.currency}</td>
                <td data-label={t('netWorth.balanceLocal')} className={item.amountClass}>
                  {formatMaybeHidden(hideValues, (v) => formatCurrencyValue(v, item.currency), item.amountLocal)}
                </td>
                <td data-label={t('netWorth.fxRateToCny')}>
                  {item.fxRate == null
                    ? t('netWorth.rateMissing')
                    : formatMaybeHidden(hideValues, formatFxRate, item.fxRate)}
                </td>
                <td data-label={`${t('netWorth.balanceBase')} (${baseCurrency})`} className={item.amountCnyClass}>
                  {item.amountCny == null
                    ? t('netWorth.rateMissing')
                    : formatMaybeHidden(hideValues, (v) => formatBaseCurrency(v, baseCurrency), item.amountCny)}
                </td>
                {hasActions && (
                  <td data-label={t('netWorth.actions')} className="positionActionsCell">
                    {onEdit && (
                      <button
                        type="button"
                        className="headerIconBtn positionActionBtn"
                        onClick={() => onEdit(item)}
                        aria-label={`${t('netWorth.edit')} ${item.instrument}`}
                        title={t('netWorth.edit')}
                      >
                        ✎
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        className="headerIconBtn positionActionBtn positionActionBtnDanger"
                        onClick={() => onDelete(item)}
                        aria-label={`${t('netWorth.delete')} ${item.instrument}`}
                        title={t('netWorth.delete')}
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
