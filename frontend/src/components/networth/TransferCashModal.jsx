import { useEffect, useMemo, useState } from 'react';
import { fetchJson, postJson } from '../../utils/api.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';
import { formatCurrencyValue } from '../../utils/formatters.js';

function accountLabel(c) {
  const name = String(c?.name || 'Cash').trim();
  const cur = String(c?.currency || '').toUpperCase();
  const bal = Number(c?.balance);
  const balStr = Number.isFinite(bal) ? formatCurrencyValue(bal, cur) : '—';
  return `${name} (${cur}) — ${balStr}`;
}

/** Plain number string for inputs, up to 8 dp, trim trailing zeros */
function formatReceiveForInput(n) {
  if (!Number.isFinite(n)) return '';
  const s = n.toFixed(8).replace(/\.?0+$/, '');
  return s === '' ? '0' : s;
}

function sanitizeDecimal(raw) {
  if (raw === '' || raw === '.') return raw;
  let v = raw.replace(/[^\d.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) {
    v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
  }
  return v;
}

/** True if receive amount implies a different credit than live mid-market conversion */
function shouldSendRateOverride(liveRate, amountNum, receiveNum) {
  if (liveRate == null || !Number.isFinite(liveRate) || liveRate <= 0) return true;
  const liveReceive = amountNum * liveRate;
  const tol = Math.max(1e-9, Math.abs(liveReceive) * 1e-8);
  return Math.abs(receiveNum - liveReceive) > tol;
}

export default function TransferCashModal({ open, onClose, onSaved, cashComponents = [] }) {
  const { t } = useLanguage();
  const list = Array.isArray(cashComponents) ? cashComponents : [];
  const positiveSources = useMemo(
    () => list.filter((c) => Number(c?.balance) > 0),
    [list],
  );
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [receiveStr, setReceiveStr] = useState('');
  const [receiveDirty, setReceiveDirty] = useState(false);
  const [liveRate, setLiveRate] = useState(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const fromAcct = useMemo(
    () => positiveSources.find((c) => String(c.id) === String(fromId)),
    [positiveSources, fromId],
  );
  const toAcct = useMemo(() => list.find((c) => String(c.id) === String(toId)), [list, toId]);

  const fromCur = fromAcct ? String(fromAcct.currency || '').toUpperCase() : '';
  const toCur = toAcct ? String(toAcct.currency || '').toUpperCase() : '';

  useEffect(() => {
    if (!open) return;
    setError('');
    setRateError('');
    setAmount('');
    setReceiveStr('');
    setReceiveDirty(false);
    setLiveRate(null);
    const first = positiveSources[0];
    const other = list.find((c) => String(c.id) !== String(first?.id));
    setFromId(first ? String(first.id) : '');
    setToId(other ? String(other.id) : '');
  }, [open, list, positiveSources]);

  useEffect(() => {
    if (!open || !fromAcct || !toAcct) {
      setLiveRate(null);
      return;
    }
    if (fromCur === toCur) {
      setLiveRate(1);
      setRateError('');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setRateLoading(true);
        setRateError('');
        const params = new URLSearchParams({ from: fromCur, to: toCur });
        const data = await fetchJson(`/api/cash/fx-rate?${params.toString()}`);
        const r = data?.rate;
        if (cancelled) return;
        if (r == null || !Number.isFinite(Number(r)) || Number(r) <= 0) {
          setLiveRate(null);
          setRateError(t('modals.rateUnavailable'));
        } else {
          setLiveRate(Number(r));
        }
      } catch (e) {
        if (!cancelled) {
          setLiveRate(null);
          setRateError(e?.message || t('modals.rateUnavailable'));
        }
      } finally {
        if (!cancelled) setRateLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, fromAcct, toAcct, fromCur, toCur, t]);

  const amountNum = Number(amount);
  const receiveNum = Number(receiveStr);

  const liveReceive =
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    liveRate != null &&
    Number.isFinite(liveRate) &&
    liveRate > 0
      ? amountNum * liveRate
      : null;

  useEffect(() => {
    if (!open || receiveDirty) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setReceiveStr('');
      return;
    }
    if (liveRate == null || !Number.isFinite(liveRate) || liveRate <= 0) {
      setReceiveStr('');
      return;
    }
    setReceiveStr(formatReceiveForInput(amt * liveRate));
  }, [open, receiveDirty, amount, liveRate, fromId, toId]);

  const executionRate =
    Number.isFinite(amountNum) && amountNum > 0 && Number.isFinite(receiveNum) && receiveNum > 0
      ? receiveNum / amountNum
      : null;

  const comparison = useMemo(() => {
    if (
      executionRate == null ||
      !Number.isFinite(executionRate) ||
      liveRate == null ||
      !Number.isFinite(liveRate) ||
      liveRate <= 0
    ) {
      return null;
    }
    const relPct = ((executionRate - liveRate) / liveRate) * 100;
    const matches = !shouldSendRateOverride(liveRate, amountNum, receiveNum);
    return { relPct, matches, executionRate };
  }, [executionRate, liveRate, amountNum, receiveNum]);

  function handleAmountChange(e) {
    const raw = e.target.value;
    if (raw === '' || raw === '-') {
      setAmount(raw);
      return;
    }
    setAmount(sanitizeDecimal(raw));
  }

  function handleReceiveChange(e) {
    setReceiveDirty(true);
    const raw = e.target.value;
    if (raw === '' || raw === '-') {
      setReceiveStr(raw);
      return;
    }
    setReceiveStr(sanitizeDecimal(raw));
  }

  async function handleTransfer() {
    if (!fromAcct || !toAcct) {
      setError(t('errors.validBalance'));
      return;
    }
    if (String(fromAcct.id) === String(toAcct.id)) {
      setError(t('errors.chooseDifferentAccounts'));
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError(t('errors.validBalance'));
      return;
    }
    if (amt > Number(fromAcct.balance)) {
      setError(t('errors.transferExceedsBalance'));
      return;
    }
    const recv = Number(receiveStr);
    if (!Number.isFinite(recv) || recv <= 0) {
      setError(t('errors.transferReceiveInvalid'));
      return;
    }
    const implied = recv / amt;
    if (!Number.isFinite(implied) || implied <= 0) {
      setError(t('modals.rateUnavailable'));
      return;
    }
    try {
      setIsSaving(true);
      setError('');
      const body = {
        fromCashId: String(fromAcct.id),
        toCashId: String(toAcct.id),
        amount: amt,
      };
      if (shouldSendRateOverride(liveRate, amt, recv)) {
        body.fxRateOverride = implied;
      }
      await postJson('/api/cash/transfer', body);
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Transfer failed.');
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) return null;

  const destOptions = list.filter((c) => String(c.id) !== String(fromId));

  const tooFewAccounts = list.length < 2;
  const noPositiveSource = !tooFewAccounts && positiveSources.length === 0;
  const formReady = !tooFewAccounts && !noPositiveSource;

  const canSubmit =
    formReady &&
    fromAcct &&
    toAcct &&
    String(toId) !== '' &&
    String(fromAcct.id) !== String(toAcct.id) &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    amountNum <= Number(fromAcct.balance) &&
    Number.isFinite(receiveNum) &&
    receiveNum > 0 &&
    executionRate != null &&
    !isSaving;

  const showCompare =
    comparison &&
    fromAcct &&
    toAcct &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    !rateLoading;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={t('modals.transferCashTitle')}>
      <section className="modalCard">
        <header className="modalHeader">
          <h2>{t('modals.transferCashTitle')}</h2>
          <button type="button" className="modalCloseBtn" onClick={onClose} aria-label={t('modals.close')}>
            ✕
          </button>
        </header>
        <div className="modalBody">
          {tooFewAccounts ? (
            <p className="hint">{t('netWorth.needTwoCashAccounts')}</p>
          ) : noPositiveSource ? (
            <p className="hint">{t('errors.needPositiveSourceForTransfer')}</p>
          ) : (
            <>
              <label className="modalLabel">
                {t('modals.fromAccount')}
                <select
                  className="modalSelect"
                  value={fromId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setReceiveDirty(false);
                    setFromId(next);
                    setToId((prev) => (prev === next ? '' : prev));
                  }}
                >
                  {positiveSources.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {accountLabel(c)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="modalLabel">
                {t('modals.toAccount')}
                <select
                  className="modalSelect"
                  value={toId}
                  onChange={(e) => {
                    setReceiveDirty(false);
                    setToId(e.target.value);
                  }}
                  disabled={!fromId}
                >
                  <option value="">{t('modals.selectCashAccount')}</option>
                  {destOptions.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {accountLabel(c)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="modalLabel">
                {t('modals.amountInSourceCurrency')}
                {fromAcct ? ` (${fromCur})` : ''}
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className="modalInput"
                  value={amount}
                  onChange={handleAmountChange}
                  placeholder="0"
                />
              </label>
              <div className="transferFxBlock">
                <p className="transferFxLine">
                  <span>
                    {fromAcct && toAcct
                      ? t('modals.liveFxRate', {
                          from: fromCur,
                          to: toCur,
                        })
                      : '—'}
                  </span>
                  <span className="transferFxRate">
                    {rateLoading ? '…' : liveRate != null ? liveRate.toFixed(6) : '—'}
                  </span>
                </p>
                {rateLoading ? <p className="hint">{t('app.loading')}</p> : null}
              </div>
              {rateError ? <p className="error transferFxError">{rateError}</p> : null}

              <label className="modalLabel">
                {t('modals.transferReceiveLabel', { currency: toCur || '—' })}
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className="modalInput"
                  value={receiveStr}
                  onChange={handleReceiveChange}
                  placeholder={t('modals.transferReceivePlaceholder')}
                />
              </label>
              {liveReceive != null && toAcct ? (
                <p className="hint transferCreditEst">
                  {t('modals.transferLiveReceiveHint')}:{' '}
                  <strong>{formatCurrencyValue(liveReceive, toCur)}</strong>
                </p>
              ) : null}

              {showCompare && comparison.matches ? (
                <p className="hint transferFxMatch">{t('modals.fxMatchesLive')}</p>
              ) : null}

              {showCompare && !comparison.matches ? (
                <div className="transferFxCompare" role="status">
                  <p className="transferFxCompareTitle">{t('modals.fxCompareSection')}</p>
                  <p className="transferFxCompareLine">
                    {t('modals.fxLive', {
                      from: fromCur,
                      rate: liveRate.toFixed(6),
                      to: toCur,
                    })}
                  </p>
                  <p className="transferFxCompareLine">
                    {t('modals.fxExecution', {
                      from: fromCur,
                      rate: comparison.executionRate.toFixed(6),
                      to: toCur,
                    })}
                  </p>
                  <p className="transferFxCompareDiff">
                    {comparison.relPct > 0
                      ? t('modals.fxDiffAbove', {
                          pct: Math.abs(comparison.relPct).toFixed(2),
                          from: fromCur,
                          to: toCur,
                        })
                      : t('modals.fxDiffBelow', {
                          pct: Math.abs(comparison.relPct).toFixed(2),
                          from: fromCur,
                          to: toCur,
                        })}
                  </p>
                </div>
              ) : null}

              {error ? <p className="error">{error}</p> : null}
            </>
          )}
        </div>
        <footer className="modalFooter">
          <button type="button" className="modalBtn secondary" onClick={onClose} disabled={isSaving}>
            {t('modals.cancel')}
          </button>
          <button type="button" className="modalBtn" onClick={handleTransfer} disabled={!canSubmit}>
            {isSaving ? t('modals.transferring') : t('modals.transfer')}
          </button>
        </footer>
      </section>
    </div>
  );
}
