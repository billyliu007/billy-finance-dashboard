import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { fetchJson, postJson } from '../../utils/api.js';

const EXCHANGE_NAMES = { binance: 'Binance', coinbase: 'Coinbase' };
const SOURCE_KEYS = { spot: 'exchange.sourceSpot', convert: 'exchange.sourceConvert', auto_invest: 'exchange.sourceAutoInvest' };

const fmtQty = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 8 });
const fmtPrice = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 6 });
const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Local calendar date (YYYY-MM-DD) of an ISO timestamp, in the viewer's time zone. */
function localDate(iso) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-CA') : '';
}

function formatWhen(iso, locale) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';
}

function TradeSummary({ trade, t, locale }) {
  return (
    <div>
      <span className={`exchangeSide ${trade.side === 'BUY' ? 'buy' : 'sell'}`}>
        {trade.source === 'auto_invest' ? `↻ ${t('exchange.sourceAutoInvest')}` : trade.side}
      </span>{' '}
      <strong>
        {fmtQty(trade.qty)} {trade.baseAsset}
      </strong>
      <div className="exchangeTradeMeta">
        @ {fmtPrice(trade.qty ? trade.quoteQty / trade.qty : 0)} {trade.quoteAsset} · {EXCHANGE_NAMES[trade.exchange] || trade.exchange}
        {trade.source !== 'spot' && trade.source !== 'auto_invest' ? ` ${t(SOURCE_KEYS[trade.source])}` : ''} ·{' '}
        {formatWhen(trade.executedAt, locale)}
        {trade.fee > 0 && trade.feeAsset ? ` · ${t('exchange.fee')} ${fmtQty(trade.fee)} ${trade.feeAsset}` : ''}
      </div>
    </div>
  );
}

/** Add form for one exchange trade, prefilled from the server's suggestion. */
function AddTradeModal({ trade, cashComponents, onClose, onAdded }) {
  const { t } = useLanguage();
  const s = trade.suggestion;
  const isBuy = trade.side === 'BUY';
  const [date, setDate] = useState(localDate(trade.executedAt));
  const [qty, setQty] = useState(String(s.qty));
  const [price, setPrice] = useState(String(s.pricePerUnit));
  const [totalAmount, setTotalAmount] = useState(s.totalAmount != null ? String(s.totalAmount) : '');
  const [feeInCrypto, setFeeInCrypto] = useState(s.feeInCrypto != null ? String(s.feeInCrypto) : '0');
  const [fee, setFee] = useState(s.fee != null ? String(s.fee) : '0');
  const [planId, setPlanId] = useState('');
  const totalMode = s.mode === 'total';

  const eligibleCash = useMemo(() => {
    const list = (cashComponents || []).filter((c) => ['USDT', 'USDC'].includes(String(c?.currency || '').toUpperCase()));
    const quote = String(trade.quoteAsset).toUpperCase();
    const exchangeName = String(EXCHANGE_NAMES[trade.exchange] || '').toLowerCase();
    const score = (c) =>
      (String(c.currency).toUpperCase() === quote ? 2 : 0) + (String(c.name || '').toLowerCase().includes(exchangeName) ? 1 : 0);
    return [...list].sort((a, b) => score(b) - score(a));
  }, [cashComponents, trade]);
  const [cashId, setCashId] = useState(eligibleCash[0] ? String(eligibleCash[0].id) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const n = (v) => Number(v);
  const netQty = totalMode ? n(qty) - n(feeInCrypto || 0) : n(qty);
  const cashChange = totalMode
    ? -n(totalAmount)
    : isBuy
      ? -(n(qty) * n(price) + n(fee || 0))
      : n(qty) * n(price) - n(fee || 0);
  const avgCost = totalMode && netQty > 0 ? n(totalAmount) / netQty : n(price);
  const cash = eligibleCash.find((c) => String(c.id) === cashId);
  const cashAfter = cash && Number.isFinite(Number(cash.balance)) ? Number(cash.balance) + cashChange : null;

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = { date, qty: n(qty), cashAccountId: cashId || null, planId: planId || null };
      if (totalMode) Object.assign(body, { totalAmount: n(totalAmount), feeInCrypto: n(feeInCrypto || 0) });
      else Object.assign(body, { pricePerUnit: n(price), fee: n(fee || 0) });
      const result = await postJson(`/api/exchange/trades/${trade.id}/add`, body);
      onAdded(result);
    } catch (err) {
      setError(err?.message || t('exchange.addFailed'));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="exchange-add-title">
      <section className="modalCard">
        <header className="modalHeader">
          <h2 id="exchange-add-title">
            {t('exchange.addTitle', { side: trade.side, asset: trade.baseAsset })}
          </h2>
          <button type="button" className="modalCloseBtn" onClick={() => !saving && onClose()} aria-label={t('modals.close')}>
            ✕
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="modalBody">
            {isBuy && trade.plans?.length > 0 && (
              <label className="modalLabel">
                {t('exchange.recordAs')}
                <select className="modalInput" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  <option value="">{t('exchange.newPurchase')}</option>
                  {trade.plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {t('exchange.addToPlan', { name: p.name })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="exchangeFormGrid">
              <label className="modalLabel">
                {t('exchange.date')}
                <input type="date" className="modalInput" value={date} onChange={(e) => setDate(e.target.value)} required />
              </label>
              <label className="modalLabel">
                {t('exchange.qty')}
                <input className="modalInput" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} required />
              </label>
              {totalMode ? (
                <>
                  <label className="modalLabel">
                    {t('exchange.totalPaid', { quote: trade.quoteAsset })}
                    <input className="modalInput" inputMode="decimal" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} required />
                  </label>
                  <label className="modalLabel">
                    {t('exchange.feeInCoin', { asset: trade.baseAsset })}
                    <input className="modalInput" inputMode="decimal" value={feeInCrypto} onChange={(e) => setFeeInCrypto(e.target.value)} />
                  </label>
                </>
              ) : (
                <>
                  <label className="modalLabel">
                    {t('exchange.price', { quote: trade.quoteAsset })}
                    <input className="modalInput" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required />
                  </label>
                  <label className="modalLabel">
                    {t('exchange.feeIn', { quote: trade.quoteAsset })}
                    <input className="modalInput" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
                  </label>
                </>
              )}
            </div>
            {s.feeEstimated && <p className="hintText">{t('exchange.feeEstimated', { asset: trade.feeAsset })}</p>}
            {s.feeMissing && <p className="hintText">{t('exchange.feeMissing', { fee: fmtQty(trade.fee), asset: trade.feeAsset })}</p>}
            <label className="modalLabel">
              {isBuy ? t('exchange.payFrom') : t('exchange.creditTo')}
              <select className="modalInput" value={cashId} onChange={(e) => setCashId(e.target.value)}>
                {eligibleCash.map((c) => (
                  <option key={c.id} value={c.id}>
                    {String(c.currency).toUpperCase()} — {c.name}
                    {Number.isFinite(Number(c.balance)) ? ` (${fmtMoney(c.balance)})` : ''}
                  </option>
                ))}
                <option value="">{t('exchange.noCash')}</option>
              </select>
            </label>
            <p className="hintText">
              {t('exchange.willRecord', { qty: fmtQty(netQty), asset: trade.baseAsset, price: fmtPrice(avgCost) })}
              {cashAfter != null ? ` · ${t('exchange.cashAfter', { amount: fmtMoney(cashAfter), currency: String(cash.currency).toUpperCase() })}` : ''}
              {` · ${t('exchange.notesOrder', { ref: trade.orderRef })}`}
            </p>
            {error && <p className="error" role="alert">{error}</p>}
          </div>
          <footer className="modalFooter">
            <button type="button" className="modalBtn secondary" onClick={onClose} disabled={saving}>
              {t('modals.cancel')}
            </button>
            <button type="submit" className="modalBtn" disabled={saving}>
              {saving ? t('exchange.adding') : t('exchange.addTrade')}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}

/** Link an exchange recurring plan to a WorthTrack recurring buy and copy its latest totals. */
function PlanUpdateModal({ plan, cashComponents, onClose, onDone }) {
  const { t } = useLanguage();
  const choices = plan.choices || [];
  const sameName = choices.find((c) => String(c.name).toLowerCase() === String(plan.name).toLowerCase());
  const [target, setTarget] = useState(plan.linked ? plan.linked.id : sameName ? sameName.id : 'new');
  const [name, setName] = useState(plan.name);
  const creating = target === 'new';
  const current = creating ? null : plan.linked && plan.linked.id === target ? plan.linked : choices.find((c) => c.id === target);
  const eligibleCash = useMemo(() => {
    const list = (cashComponents || []).filter((c) => ['USDT', 'USDC'].includes(String(c?.currency || '').toUpperCase()));
    const quote = String(plan.sourceAsset).toUpperCase();
    return [...list].sort((a, b) => (String(b.currency).toUpperCase() === quote) - (String(a.currency).toUpperCase() === quote));
  }, [cashComponents, plan.sourceAsset]);
  // A new plan's full history usually predates the cash balance, so don't move cash unless asked.
  const [cashId, setCashId] = useState(plan.linked && eligibleCash[0] ? String(eligibleCash[0].id) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const oldQty = current ? Number(current.qty) : 0;
  const oldInvested = current ? Number(current.invested) : 0;
  const cashMove = Number(plan.totalInvested) - oldInvested;
  const cash = eligibleCash.find((c) => String(c.id) === cashId);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = creating ? { create: true, name } : { recurringId: target };
      body.cashAccountId = cashId || null;
      const result = await postJson(`/api/exchange/plans/${plan.id}/apply`, body);
      onDone(result);
    } catch (err) {
      setError(err?.message || t('exchange.planFailed'));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="exchange-plan-title">
      <section className="modalCard">
        <header className="modalHeader">
          <h2 id="exchange-plan-title">↻ {plan.name}</h2>
          <button type="button" className="modalCloseBtn" onClick={() => !saving && onClose()} aria-label={t('modals.close')}>
            ✕
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="modalBody">
            {!plan.linked && (
              <label className="modalLabel">
                {t('exchange.planKeepUpdated', { asset: plan.targetAsset })}
                <select className="modalInput" value={target} onChange={(e) => setTarget(e.target.value)}>
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      ↻ {c.name}
                    </option>
                  ))}
                  <option value="new">{t('exchange.planCreateNew')}</option>
                </select>
              </label>
            )}
            {creating && (
              <label className="modalLabel">
                {t('exchange.planName')}
                <input className="modalInput" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
              </label>
            )}
            <div className="exchangePlanCompare">
              <div>
                <span>{t('exchange.planBought')}</span>
                <strong>
                  {current ? `${fmtQty(oldQty)} → ` : ''}
                  {fmtQty(plan.totalQty)} {plan.targetAsset}
                </strong>
              </div>
              <div>
                <span>{t('exchange.planInvested')}</span>
                <strong>
                  {current ? `${fmtMoney(oldInvested)} → ` : ''}
                  {fmtMoney(plan.totalInvested)} {plan.sourceAsset}
                </strong>
              </div>
              <div>
                <span>{t('exchange.planAvgCost')}</span>
                <strong>{fmtPrice(plan.totalQty ? plan.totalInvested / plan.totalQty : 0)}</strong>
              </div>
            </div>
            <label className="modalLabel">
              {cashMove >= 0 ? t('exchange.payFrom') : t('exchange.creditTo')}
              <select className="modalInput" value={cashId} onChange={(e) => setCashId(e.target.value)}>
                <option value="">{t('exchange.noCash')}</option>
                {eligibleCash.map((c) => (
                  <option key={c.id} value={c.id}>
                    {String(c.currency).toUpperCase()} — {c.name}
                    {Number.isFinite(Number(c.balance)) ? ` (${fmtMoney(c.balance)})` : ''}
                  </option>
                ))}
              </select>
            </label>
            {cash && (
              <p className="hintText">
                {t('exchange.planCashMove', {
                  amount: fmtMoney(Math.abs(cashMove)),
                  currency: String(cash.currency).toUpperCase(),
                  after: fmtMoney(Number(cash.balance) - cashMove),
                })}
              </p>
            )}
            <p className="hintText">{t('exchange.planHint')}</p>
            {error && <p className="error" role="alert">{error}</p>}
          </div>
          <footer className="modalFooter">
            <button type="button" className="modalBtn secondary" onClick={onClose} disabled={saving}>
              {t('modals.cancel')}
            </button>
            <button type="submit" className="modalBtn" disabled={saving}>
              {saving ? t('exchange.adding') : creating ? t('exchange.planCreate') : t('exchange.planUpdate')}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}

function PlanSummary({ plan, t }) {
  return (
    <div>
      <span className="exchangeSide buy">↻ {t('exchange.sourceAutoInvest')}</span> <strong>{plan.name}</strong>
      <div className="exchangeTradeMeta">
        Binance{plan.planStatus === 'PAUSED' ? ` · ${t('exchange.planPaused')}` : ''} · {fmtQty(plan.totalQty)} {plan.targetAsset} ·{' '}
        {t('exchange.planInvestedShort', { amount: fmtMoney(plan.totalInvested), currency: plan.sourceAsset })}
      </div>
      <div className="exchangeTradeMeta">
        {plan.ignored
          ? t('exchange.planIgnored')
          : plan.linked
            ? t('exchange.planLinked', { name: plan.linked.name, qty: fmtQty(plan.linked.qty), amount: fmtMoney(plan.linked.invested) })
            : t('exchange.planNotLinked')}
      </div>
    </div>
  );
}

/**
 * Holdings: checks connected exchanges (server limits this to once per 10 minutes), shows a
 * banner when trades from the last 7 days are not recorded, and lets the user add or ignore them.
 */
export default function ExchangeSyncPanel({ cashComponents, onRecorded }) {
  const { language, t } = useLanguage();
  const { showToast } = useToast();
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const [data, setData] = useState(null);
  const [days, setDays] = useState(7);
  const [checking, setChecking] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [reviewOpen, setReviewOpen] = useState(() => searchParams.get('review') === 'exchange');
  const [showResolved, setShowResolved] = useState(null); // null = auto (open when nothing is pending)
  const [adding, setAdding] = useState(null);
  const [planEditing, setPlanEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const runSync = useCallback(async ({ force = false, windowDays = 7 } = {}) => {
    setChecking(true);
    try {
      const result = await postJson('/api/exchange/sync', { days: windowDays, force });
      setData(result);
      const failed = (result?.sync || []).find((r) => r.error);
      if (force && failed) showToast(failed.error, { variant: 'error' });
    } catch (error) {
      if (force) showToast(error?.message || t('exchange.checkFailed'), { variant: 'error' });
    } finally {
      setChecking(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const conns = await fetchJson('/api/exchange/connections');
        if (!cancelled && conns?.connections?.length > 0) await runSync();
      } catch {
        // Exchange sync is optional; Holdings works without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runSync]);

  const reload = useCallback(async (windowDays = days) => {
    try {
      setData(await fetchJson('/api/exchange/trades', { params: new URLSearchParams({ days: String(windowDays) }) }));
    } catch (error) {
      showToast(error?.message || t('exchange.loadFailed'), { variant: 'error' });
    }
  }, [days, showToast, t]);

  function closeReview() {
    setReviewOpen(false);
    if (searchParams.get('review')) {
      const next = new URLSearchParams(searchParams);
      next.delete('review');
      setSearchParams(next, { replace: true });
    }
  }

  if (!data || !data.connections?.length) return null;
  const pending = data.trades || [];
  const plans = data.plans || [];
  const pendingPlans = plans.filter((p) => p.needsUpdate);
  const settledPlans = plans.filter((p) => !p.needsUpdate);
  const attention = pending.length + pendingPlans.length;
  const resolved = data.resolved || [];
  const counts = data.counts || {};
  const syncError = (data.sync || []).find((r) => r.error);
  const resolvedOpen = showResolved ?? attention === 0;

  async function act(trade, action) {
    setBusyId(trade.id);
    try {
      await postJson(`/api/exchange/trades/${trade.id}/${action}`, {});
      if (action === 'ignore') showToast(t('exchange.ignoredToast'), { variant: 'success' });
      await reload();
    } catch (error) {
      showToast(error?.message || t('exchange.actionFailed'), { variant: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function planAction(plan, action) {
    setBusyId(plan.id);
    try {
      await postJson(`/api/exchange/plans/${plan.id}/${action}`, {});
      await reload();
    } catch (error) {
      showToast(error?.message || t('exchange.actionFailed'), { variant: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function changeDays(value) {
    const d = Number(value);
    setDays(d);
    await runSync({ windowDays: d, force: d > 7 });
  }

  return (
    <>
      {(
        <div className={`exchangeBanner ${attention > 0 ? '' : syncError ? 'isError' : 'isQuiet'}`}>
          <span>
            {attention > 0
              ? [
                pending.length > 0
                  ? t(pending.length === 1 ? 'exchange.bannerCountOne' : 'exchange.bannerCount', { count: pending.length, days: data.days })
                  : null,
                pendingPlans.length > 0
                  ? t(pendingPlans.length === 1 ? 'exchange.bannerPlansOne' : 'exchange.bannerPlans', { count: pendingPlans.length })
                  : null,
              ].filter(Boolean).join(' · ')
              : syncError
                ? t('exchange.bannerError', { message: syncError.error })
                : t('exchange.bannerCaughtUp', { days: data.days, recorded: (counts.matched || 0) + (counts.added || 0) })}
          </span>
          <span className="positionInlineActions">
            <button
              type="button"
              className="headerIconBtn positionActionBtn"
              onClick={() => runSync({ force: true, windowDays: days })}
              disabled={checking}
              aria-label={t('exchange.checkNow')}
              title={t('exchange.checkNow')}
            >
              {checking ? '…' : '⟳'}
            </button>
            <button type="button" className={`modalBtn ${attention > 0 ? '' : 'secondary'}`} onClick={() => setReviewOpen(true)}>
              {attention > 0 ? t('exchange.review') : t('exchange.viewTrades')}
            </button>
          </span>
        </div>
      )}

      {reviewOpen && !adding && !planEditing && createPortal(
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="exchange-review-title">
          <section className="modalCard modalCard--wide">
            <header className="modalHeader">
              <h2 id="exchange-review-title">{t('exchange.reviewTitle')}</h2>
              <button type="button" className="modalCloseBtn" onClick={closeReview} aria-label={t('modals.close')}>
                ✕
              </button>
            </header>
            <div className="modalBody">
              <div className="exchangeReviewBar">
                <select className="modalInput exchangeDays" value={days} onChange={(e) => changeDays(e.target.value)} disabled={checking}>
                  <option value={7}>{t('exchange.lastDays', { days: 7 })}</option>
                  <option value={30}>{t('exchange.lastDays', { days: 30 })}</option>
                </select>
                {checking && <span className="settingsMuted">{t('exchange.checking')}</span>}
              </div>
              {pendingPlans.length > 0 && (
                <>
                  <h3 className="exchangeSectionTitle">{t('exchange.plansTitle')}</h3>
                  <ul className="exchangeTradeList">
                    {pendingPlans.map((plan) => (
                      <li key={plan.id} className="exchangeTradeRow">
                        <PlanSummary plan={plan} t={t} />
                        <span className="exchangeTradeActions">
                          <button type="button" className="modalBtn secondary" onClick={() => planAction(plan, 'ignore')} disabled={busyId === plan.id}>
                            {t('exchange.ignore')}
                          </button>
                          <button type="button" className="modalBtn" onClick={() => setPlanEditing(plan)} disabled={busyId === plan.id}>
                            {plan.linked ? t('exchange.planUpdate') : t('exchange.planSetUp')}
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {pending.length > 0 && <h3 className="exchangeSectionTitle">{t('exchange.tradesTitle')}</h3>}
                </>
              )}
              {attention === 0 && <p className="settingsMuted">{t('exchange.allCaughtUp')}</p>}
              <ul className="exchangeTradeList">
                {pending.map((trade) => (
                  <li key={trade.id} className="exchangeTradeRow">
                    <TradeSummary trade={trade} t={t} locale={locale} />
                    <span className="exchangeTradeActions">
                      <button type="button" className="modalBtn secondary" onClick={() => act(trade, 'ignore')} disabled={busyId === trade.id}>
                        {t('exchange.ignore')}
                      </button>
                      {trade.suggestion?.supported ? (
                        <button type="button" className="modalBtn" onClick={() => setAdding(trade)} disabled={busyId === trade.id}>
                          {t('exchange.add')}
                        </button>
                      ) : (
                        <span className="settingsMuted exchangeUnsupported">{t('exchange.manualOnly')}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="exchangeResolvedBar">
                <span className="settingsMuted">
                  {t('exchange.resolvedSummary', { recorded: (counts.matched || 0) + (counts.added || 0), ignored: counts.ignored || 0 })}
                </span>
                {resolved.length + settledPlans.length > 0 && (
                  <button type="button" className="passkeyCancelBtn" onClick={() => setShowResolved(!resolvedOpen)}>
                    {resolvedOpen ? t('exchange.hide') : t('exchange.show')}
                  </button>
                )}
              </div>
              {resolvedOpen && (
                <ul className="exchangeTradeList isResolved">
                  {settledPlans.map((plan) => (
                    <li key={plan.id} className="exchangeTradeRow">
                      <PlanSummary plan={plan} t={t} />
                      <span className="exchangeTradeActions">
                        <span className={`settingsBadge ${plan.ignored ? 'settingsBadgeRevoked' : 'settingsBadgeActive'}`}>
                          {plan.ignored ? t('exchange.status.ignored') : t('exchange.planUpToDate')}
                        </span>
                        {plan.ignored && (
                          <button type="button" className="passkeyCancelBtn" onClick={() => planAction(plan, 'restore')} disabled={busyId === plan.id}>
                            {t('exchange.restore')}
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                  {resolved.map((trade) => (
                    <li key={trade.id} className="exchangeTradeRow">
                      <TradeSummary trade={trade} t={t} locale={locale} />
                      <span className="exchangeTradeActions">
                        <span className={`settingsBadge ${trade.status === 'ignored' ? 'settingsBadgeRevoked' : 'settingsBadgeActive'}`}>
                          {t(`exchange.status.${trade.status}`)}
                        </span>
                        {(trade.status === 'ignored' || trade.status === 'matched') && (
                          <button type="button" className="passkeyCancelBtn" onClick={() => act(trade, 'restore')} disabled={busyId === trade.id}>
                            {t('exchange.restore')}
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>,
        document.body,
      )}

      {planEditing && (
        <PlanUpdateModal
          plan={planEditing}
          cashComponents={cashComponents}
          onClose={() => setPlanEditing(null)}
          onDone={async (result) => {
            setPlanEditing(null);
            showToast(
              result?.created ? t('exchange.planCreatedToast', { name: result.name }) : t('exchange.planUpdatedToast', { name: result?.name }),
              { variant: 'success' },
            );
            await reload();
            onRecorded?.();
          }}
        />
      )}

      {adding && (
        <AddTradeModal
          trade={adding}
          cashComponents={cashComponents}
          onClose={() => setAdding(null)}
          onAdded={async (result) => {
            setAdding(null);
            showToast(
              result?.addedTo === 'plan' ? t('exchange.addedToPlan', { name: result.planName }) : t('exchange.addedToast'),
              { variant: 'success' },
            );
            await reload();
            onRecorded?.();
          }}
        />
      )}
    </>
  );
}
