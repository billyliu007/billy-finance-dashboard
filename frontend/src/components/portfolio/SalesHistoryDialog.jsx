import { useEffect, useMemo, useState } from 'react';
import { fetchJson, postJson } from '../../utils/api.js';
import { formatMaybeHidden, formatMoney, formatPercent, formatQty } from '../../utils/formatters.js';

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

export default function SalesHistoryDialog({ open, onClose, symbol, hideValues, onHistoryCountChange }) {
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
      setError(err?.message || 'Failed to load sales history.');
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
      setError('Paste at least one row to import.');
      return;
    }
    try {
      setImporting(true);
      const res = await postJson(`/api/portfolio/positions/${encodeURIComponent(sym)}/sales-history/import`, {
        rows: parsed.rows,
      });
      setImportRaw('');
      setImportResult(`Imported ${Number(res?.imported) || parsed.rows.length} rows.`);
      await loadHistory();
    } catch (err) {
      setError(err?.message || 'Failed to import sales history.');
    } finally {
      setImporting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Sales history">
      <section className="modalCard" style={{ maxWidth: 860 }}>
        <header className="modalHeader">
          <h2>Sold history (does not affect holdings)</h2>
          <button type="button" className="modalCloseBtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="modalBody">
          <p className="hintText" style={{ marginTop: 0 }}>
            Import format: one row per line, CSV or TSV:
            <br />
            <code>YYYY-MM-DD, qty, sellPricePerUnit, costBasisPerUnit, notes(optional)</code>
          </p>

          <label className="modalLabel">
            Paste rows to import
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
              Parsed {parsed.rows.length} rows{parsed.errors.length ? `, ${parsed.errors.length} errors` : ''}.
            </p>
          )}

          <div className="modalFooter" style={{ justifyContent: 'flex-start', padding: 0, marginTop: 10 }}>
            <button type="button" className="modalBtn" onClick={handleImport} disabled={importing || loading}>
              {importing ? 'Importing…' : 'Import'}
            </button>
            <button type="button" className="modalBtn secondary" onClick={loadHistory} disabled={importing || loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
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
              History for {sym}
            </h3>
            {loading ? (
              <p>Loading…</p>
            ) : history.length === 0 ? (
              <p className="positionTxEmpty">No imported sold history.</p>
            ) : (
              <div className="tableWrap">
                <table className="positionTxTable salesHistoryTable">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Qty</th>
                      <th>Sell Price</th>
                      <th>Cost / Unit</th>
                      <th>Sale Amount</th>
                      <th>Realized P/L</th>
                      <th>Realized Return (%)</th>
                      <th>Notes</th>
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
                          <td>{formatMaybeHidden(hideValues, formatMoney, sellPrice)}</td>
                          <td>{formatMaybeHidden(hideValues, formatMoney, basis)}</td>
                          <td>{formatMaybeHidden(hideValues, formatMoney, proceeds)}</td>
                          <td className={realized >= 0 ? 'pos' : 'neg'}>
                            {formatMaybeHidden(hideValues, formatMoney, realized)}
                          </td>
                          <td className={realized >= 0 ? 'pos' : 'neg'}>
                            {hideValues ? 'Hidden' : formatPercent(realizedPct)}
                          </td>
                          <td>{row.notes || ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="salesHistorySummaryRow">
                      <td>Total / Avg</td>
                      <td>{formatMaybeHidden(hideValues, formatQty, summary.qtySum)}</td>
                      <td>{formatMaybeHidden(hideValues, formatMoney, summary.avgSell)}</td>
                      <td>{formatMaybeHidden(hideValues, formatMoney, summary.avgBasis)}</td>
                      <td>{formatMaybeHidden(hideValues, formatMoney, summary.proceedsSum)}</td>
                      <td className={summary.realizedSum >= 0 ? 'pos' : 'neg'}>
                        {formatMaybeHidden(hideValues, formatMoney, summary.realizedSum)}
                      </td>
                      <td className={summary.realizedSum >= 0 ? 'pos' : 'neg'}>
                        {hideValues ? 'Hidden' : formatPercent(summary.realizedPct)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>

        <footer className="modalFooter">
          <button type="button" className="modalBtn secondary" onClick={onClose}>
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}

