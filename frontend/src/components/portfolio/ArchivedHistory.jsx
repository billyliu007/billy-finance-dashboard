import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { fetchJson, postJson } from '../../utils/api.js';

const fmtQty = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 8 });
const fmtPrice = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 6 });
const fmtMoney = (n) => {
  const v = Number(n || 0);
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}$${s}`;
};

/** Realized P/L of one sale: proceeds after fee minus its cost basis. */
function saleRealized(t) {
  return Number(t.qty) * (Number(t.pricePerUnit) - Number(t.costBasisPerUnit || 0)) - Number(t.feeFlat || 0);
}

function formatDate(iso, locale) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function ArchiveRound({ round, canRestore, onRestore, busy, t, locale }) {
  const [open, setOpen] = useState(false);
  const buys = round.transactions.filter((x) => x.type === 'BUY');
  const sells = round.transactions.filter((x) => x.type === 'SELL');
  const realized = sells.reduce((acc, s) => acc + saleRealized(s), 0);

  return (
    <li className="archiveRound">
      <div className="archiveRoundHead">
        <button type="button" className="headerIconBtn positionExpandBtn" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={t('archive.toggle')}>
          {open ? '▾' : '▸'}
        </button>
        <div className="archiveRoundTitle">
          <strong>{round.symbol}</strong>
          <span className="archiveRoundMeta">
            {t('archive.archivedOn', { date: formatDate(round.archivedAt, locale) })} ·{' '}
            {t('archive.counts', { buys: buys.length + (round.baseQty > 0 ? 1 : 0), sells: sells.length })}
          </span>
        </div>
        <span className={`archiveRoundPnl ${realized >= 0 ? 'pos' : 'neg'}`}>{sells.length > 0 ? fmtMoney(realized) : '—'}</span>
        {canRestore && (
          <button type="button" className="passkeyCancelBtn" onClick={() => onRestore(round)} disabled={busy}>
            {t('archive.restore')}
          </button>
        )}
      </div>
      {open && (
        <div className="archiveRoundBody">
          <h4>{t('archive.purchases')}</h4>
          {buys.length === 0 && !(round.baseQty > 0) ? (
            <p className="settingsMuted">{t('archive.none')}</p>
          ) : (
            <div className="tableWrap">
              <table className="archiveTable">
                <thead>
                  <tr>
                    <th>{t('modals.historyTableDate')}</th>
                    <th>{t('portfolio.quantity')}</th>
                    <th>{t('portfolio.avgCostPerUnit')}</th>
                    <th>{t('portfolio.costBasis')}</th>
                  </tr>
                </thead>
                <tbody>
                  {round.baseQty > 0 && (
                    <tr>
                      <td>{t('portfolio.initialHolding')}</td>
                      <td>{fmtQty(round.baseQty)}</td>
                      <td>{fmtPrice(round.baseAvgCost)}</td>
                      <td>{fmtMoney(round.baseQty * round.baseAvgCost)}</td>
                    </tr>
                  )}
                  {buys.map((b) => (
                    <tr key={b.id}>
                      <td>
                        {b.txDate}
                        {b.isRecurring && b.notes ? <span className="recurringName">↻ {b.notes}</span> : null}
                      </td>
                      <td>{fmtQty(b.qty)}</td>
                      <td>{fmtPrice(b.pricePerUnit)}</td>
                      <td>{fmtMoney(b.qty * b.pricePerUnit + Number(b.feeFlat || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h4>{t('archive.sales')}</h4>
          {sells.length === 0 ? (
            <p className="settingsMuted">{t('archive.none')}</p>
          ) : (
            <div className="tableWrap">
              <table className="archiveTable">
                <thead>
                  <tr>
                    <th>{t('modals.historyTableDate')}</th>
                    <th>{t('modals.historyTableQty')}</th>
                    <th>{t('modals.historyTableSellPrice')}</th>
                    <th>{t('modals.historyTableCostPerUnit')}</th>
                    <th>{t('modals.historyTableRealizedPl')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sells.map((s) => {
                    const r = saleRealized(s);
                    return (
                      <tr key={s.id}>
                        <td>{s.txDate}</td>
                        <td>{fmtQty(s.qty)}</td>
                        <td>{fmtPrice(s.pricePerUnit)}</td>
                        <td>{fmtPrice(s.costBasisPerUnit)}</td>
                        <td className={r >= 0 ? 'pos' : 'neg'}>{fmtMoney(r)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Holdings → Archived history: sealed rounds of archived assets (read-only). The latest round of an
 * asset with no new activity can be restored.
 */
export default function ArchivedHistory({ activeSymbols, reloadKey, onRestored }) {
  const { language, t } = useLanguage();
  const { showToast } = useToast();
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const [archives, setArchives] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchJson('/api/portfolio/archives');
      setArchives(Array.isArray(data?.archives) ? data.archives : []);
    } catch {
      // Holdings works without the archive list.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  if (archives.length === 0) return null;

  const active = new Set((activeSymbols || []).map((s) => String(s).toUpperCase()));
  const latestBySymbol = new Map();
  for (const a of archives) {
    if (!latestBySymbol.has(a.symbol)) latestBySymbol.set(a.symbol, a.id); // newest first
  }

  async function restore(round) {
    setBusy(true);
    try {
      await postJson(`/api/portfolio/archives/${round.id}/restore`, {});
      showToast(t('archive.restored', { symbol: round.symbol }), { variant: 'success' });
      await load();
      onRestored?.();
    } catch (error) {
      showToast(error?.message || t('archive.restoreFailed'), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="tableCard archiveCard">
      <button type="button" className="archiveCardHead" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <h2>{t('archive.title')}</h2>
        <span className="archiveCount">{archives.length}</span>
        <span className="archiveChevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <p className="settingsMuted archiveHint">{t('archive.hint')}</p>
          <ul className="archiveList">
            {archives.map((round) => (
              <ArchiveRound
                key={round.id}
                round={round}
                canRestore={latestBySymbol.get(round.symbol) === round.id && !active.has(round.symbol)}
                onRestore={restore}
                busy={busy}
                t={t}
                locale={locale}
              />
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
