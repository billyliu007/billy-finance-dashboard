import { useEffect, useMemo, useState } from 'react';
import { deleteJson, fetchJson, postJson } from '../../utils/api.js';
import { formatMaybeHidden, formatPercent, formatQty } from '../../utils/formatters.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

function parseDelimitedLines(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return { rows: [], errors: [] };

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const errors = [];
  const rows = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^date\b/i.test(line) || /^tx[_\s-]?date\b/i.test(line)) {
      continue; // header line
    }
    const parts = line.split(/[,\t]/).map((p) => p.trim());
    if (parts.length < 4) {
      errors.push(`Line ${i + 1}: expected 4 fields (date, qty, sellPricePerUnit, costBasisPerUnit).`);
      continue;
    }
    const [txDate, qtyRaw, sellRaw, basisRaw, ...noteParts] = parts;
    const qty = Number(qtyRaw);
    const sellPricePerUnit = Number(sellRaw);
    const costBasisPerUnit = Number(basisRaw);
    const notes = noteParts.length ? noteParts.join(' ').trim() : null;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(txDate)) {
      errors.push(`Line ${i + 1}: invalid date "${txDate}" (use YYYY-MM-DD).`);
      continue;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`Line ${i + 1}: qty must be > 0.`);
      continue;
    }
    if (!Number.isFinite(sellPricePerUnit) || sellPricePerUnit < 0) {
      errors.push(`Line ${i + 1}: sellPricePerUnit must be >= 0.`);
      continue;
    }
    if (!Number.isFinite(costBasisPerUnit) || costBasisPerUnit < 0) {
      errors.push(`Line ${i + 1}: costBasisPerUnit must be >= 0.`);
      continue;
    }

    rows.push({
      txDate,
      qty,
      sellPricePerUnit,
      costBasisPerUnit,
      notes,
    });
  }

  return { rows, errors };
}

export default function SalesHistoryDialog({ open, onClose, symbol, hideValues, onHistoryCountChange, isCrypto = false }) {
  const { t } = useLanguage();
  const sym = String(symbol || '').trim().toUpperCase();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importRaw, setImportRaw] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [importResult, setImportResult] = useState('');

  const parsed = useMemo(() => parseDelimitedLines(importRaw), [importRaw]);

  const summary = useMemo(() => {
    const rows = Array.isArray(history) ? history : [];
    let qtySum = 0;
    let proceedsSum = 0;
    let costSum = 0;
    for (const row of rows) {
      const qty = Number(row?.qty) || 0;
      const sellPrice = Number(row?.sellPricePerUnit) || 0;
      const basis = Number(row?.costBasisPerUnit) || 0;
      qtySum += qty;
      proceedsSum += qty * sellPrice;
      costSum += qty * basis;
    }
    const realizedSum = proceedsSum - costSum;
    const avgSell = qtySum > 0 ? proceedsSum / qtySum : 0;
    const avgBasis = qtySum > 0 ? costSum / qtySum : 0;
    const realizedPct = costSum === 0 ? 0 : (realizedSum / costSum) * 100;
    return {
      qtySum,
      proceedsSum,
      costSum,
      realizedSum,
      avgSell,
      avgBasis,
      realizedPct,
    };
  }, [history]);

  const usdFractionDigits = isCrypto ? 4 : 2;
  const formatUsd = (value) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: usdFractionDigits,
      maximumFractionDigits: usdFractionDigits,
    }).format(value);

  async function loadHistory() {
    if (!sym) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetchJson(`/api/portfolio/positions/${encodeURIComponent(sym)}/sales-history`);
      const list = Array.isArray(res?.history) ? res.history : [];
      setHistory(list);
      onHistoryCountChange?.(sym, list.length);
    } catch (err) {
      setError(err?.message || t('errors.failedLoadSalesHistory'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setImportResult('');
    setError('');
    loadHistory();
  }, [open, sym]);

  async function handleImport() {
    setImportResult('');
    setError('');
    if (!sym) return;
    if (parsed.errors.length) {
      setError(parsed.errors.slice(0, 5).join('\n'));
      return;
    }
    if (parsed.rows.length === 0) {
      setError(t('errors.pasteAtLeastOneRowToImport'));
      return;
    }
    try {
      setImporting(true);
      const res = await postJson(`/api/portfolio/positions/${encodeURIComponent(sym)}/sales-history/import`, {
        rows: parsed.rows,
      });
      setImportRaw('');
      setImportResult(
        t('modals.importedResult', { count: Number(res?.imported) || parsed.rows.length }),
      );
      await loadHistory();
    } catch (err) {
      setError(err?.message || t('errors.failedImportSalesHistory'));
    } finally {
      setImporting(false);
    }
  }

  async function handleClearHistory() {
    setImportResult('');
    setError('');
    if (!sym) return;
    const confirmed = window.confirm(t('modals.clearAllHistoryConfirm', { symbol: sym }));
    if (!confirmed) return;
    try {
      setImporting(true);
      const res = await deleteJson(`/api/portfolio/positions/${encodeURIComponent(sym)}/sales-history`);
      setImportResult(t('modals.clearedResult', { count: Number(res?.deleted) || 0 }));
      await loadHistory();
    } catch (err) {
      setError(err?.message || t('errors.failedClearSalesHistory'));
    } finally {
      setImporting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={t('modals.soldHistoryTitle')}>
      <section className="modalCard modalCard--wide">
        <header className="modalHeader">
          <h2>{t('modals.soldHistoryTitle')}</h2>
          <button type="button" className="modalCloseBtn" onClick={onClose} aria-label={t('modals.close')}>
            ✕
          </button>
        </header>

        <div className="modalBody">
          <p className="hintText" style={{ marginTop: 0 }}>
            {t('modals.importFormatTitle')}
            <br />
            <code>YYYY-MM-DD, qty, sellPricePerUnit, costBasisPerUnit, notes(optional)</code>
          </p>

          <label className="modalLabel">
            {t('modals.pasteRowsToImport')}
            <textarea
              className="modalInput"
              style={{ minHeight: 120, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
              value={importRaw}
              onChange={(e) => setImportRaw(e.target.value)}
              placeholder={'2024-01-15, 10, 120.50, 98.00, partial lot\n2024-02-02\t5\t130\t98\tsecond lot'}
            />
          </label>

          {importRaw.trim() && (
            <p className="hintText" style={{ marginTop: 6 }}>
              {t('modals.parsedRowsPrefix', { count: parsed.rows.length })}
              {parsed.errors.length ? t('modals.parsedErrorsSuffix', { count: parsed.errors.length }) : ''}
            </p>
          )}

          <div className="modalFooter" style={{ justifyContent: 'flex-start', padding: 0, marginTop: 10 }}>
            <button type="button" className="modalBtn" onClick={handleImport} disabled={importing || loading}>
              {importing ? t('modals.importing') : t('modals.import')}
            </button>
            <button
              type="button"
              className="modalBtn secondary"
              onClick={handleClearHistory}
              disabled={importing || loading || history.length === 0}
              title={history.length === 0 ? t('modals.noImportedHistoryToClear') : t('modals.clearImportedHistory')}
            >
              {t('modals.clearHistory')}
            </button>
            {importResult && <span className="hintText" style={{ marginLeft: 10 }}>{importResult}</span>}
          </div>

          {error && (
            <pre className="error" style={{ whiteSpace: 'pre-wrap' }}>
              {error}
            </pre>
          )}

          <div style={{ marginTop: 14 }}>
            <h3 style={{ margin: '8px 0 10px', fontSize: '0.9rem', color: '#dbeafe' }}>
              {t('modals.historyFor', { symbol: sym })}
            </h3>
            {loading ? (
              <p>{t('app.loading')}</p>
            ) : history.length === 0 ? (
              <p className="positionTxEmpty">{t('modals.noImportedSoldHistory')}</p>
            ) : (
              <div className="tableWrap salesHistoryWrap">
                <table className="positionTxTable salesHistoryTable">
                  <thead>
                    <tr>
                      <th>{t('modals.historyTableDate')}</th>
                      <th>{t('modals.historyTableQty')}</th>
                      <th>{t('modals.historyTableSellPrice')}</th>
                      <th>{t('modals.historyTableCostPerUnit')}</th>
                      <th>{t('modals.historyTableSaleAmount')}</th>
                      <th>{t('modals.historyTableRealizedPl')}</th>
                      <th>{t('modals.historyTableRealizedReturn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => {
                      const qty = Number(row.qty) || 0;
                      const sellPrice = Number(row.sellPricePerUnit) || 0;
                      const basis = Number(row.costBasisPerUnit) || 0;
                      const proceeds = qty * sellPrice;
                      const costSold = qty * basis;
                      const realized = proceeds - costSold;
                      const realizedPct = costSold === 0 ? 0 : (realized / costSold) * 100;
                      return (
                        <tr key={row.id}>
                          <td>{row.txDate}</td>
                          <td>{formatMaybeHidden(hideValues, formatQty, qty)}</td>
                          <td>{formatMaybeHidden(hideValues, formatUsd, sellPrice)}</td>
                          <td>{formatMaybeHidden(hideValues, formatUsd, basis)}</td>
                          <td>{formatMaybeHidden(hideValues, formatUsd, proceeds)}</td>
                          <td className={realized >= 0 ? 'pos' : 'neg'}>
                            {formatMaybeHidden(hideValues, formatUsd, realized)}
                          </td>
                          <td className={realized >= 0 ? 'pos' : 'neg'}>
                            {hideValues ? 'Hidden' : formatPercent(realizedPct)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="salesHistorySummaryRow">
                      <td>{t('modals.historyTotalAvg')}</td>
                      <td>{formatMaybeHidden(hideValues, formatQty, summary.qtySum)}</td>
                      <td>{formatMaybeHidden(hideValues, formatUsd, summary.avgSell)}</td>
                      <td>{formatMaybeHidden(hideValues, formatUsd, summary.avgBasis)}</td>
                      <td>{formatMaybeHidden(hideValues, formatUsd, summary.proceedsSum)}</td>
                      <td className={summary.realizedSum >= 0 ? 'pos' : 'neg'}>
                        {formatMaybeHidden(hideValues, formatUsd, summary.realizedSum)}
                      </td>
                      <td className={summary.realizedSum >= 0 ? 'pos' : 'neg'}>
                        {hideValues ? 'Hidden' : formatPercent(summary.realizedPct)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>

        <footer className="modalFooter">
          <button type="button" className="modalBtn secondary" onClick={onClose}>
            {t('modals.close')}
          </button>
        </footer>
      </section>
    </div>
  );
}

