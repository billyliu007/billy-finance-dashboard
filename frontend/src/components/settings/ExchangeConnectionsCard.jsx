import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { deleteJson, fetchJson, postJson } from '../../utils/api.js';

const EXCHANGES = [
  { id: 'binance', name: 'Binance', available: true },
  { id: 'coinbase', name: 'Coinbase', available: false },
];

function formatTs(value, locale) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString(locale) : '—';
}

/** Settings → Exchange connections: add, check and remove read-only exchange API keys. */
export default function ExchangeConnectionsCard() {
  const { language, t } = useLanguage();
  const { showToast } = useToast();
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [connectOpen, setConnectOpen] = useState(false);
  const [exchange, setExchange] = useState('binance');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoadError('');
      const data = await fetchJson('/api/exchange/connections');
      setConnections(Array.isArray(data?.connections) ? data.connections : []);
    } catch (error) {
      setLoadError(error?.message || t('exchange.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  function openConnect() {
    setExchange('binance');
    setApiKey('');
    setApiSecret('');
    setFormError('');
    setConnectOpen(true);
  }

  async function handleConnect(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await postJson('/api/exchange/connections', { exchange, apiKey: apiKey.trim(), apiSecret: apiSecret.trim() });
      setConnectOpen(false);
      setApiKey('');
      setApiSecret('');
      showToast(t('exchange.connected'), { variant: 'success' });
      await load();
    } catch (error) {
      setFormError(error?.message || t('exchange.connectFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleCheck(id) {
    setBusy(`check-${id}`);
    try {
      const data = await postJson('/api/exchange/sync', { days: 7, force: true });
      const result = (data?.sync || []).find((r) => r.exchange === id);
      if (result?.error) showToast(result.error, { variant: 'error' });
      else showToast(t('exchange.checkedCount', { count: data?.counts?.new ?? 0 }), { variant: 'success' });
      await load();
    } catch (error) {
      showToast(error?.message || t('exchange.checkFailed'), { variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove(id) {
    setBusy(`remove-${id}`);
    try {
      await deleteJson(`/api/exchange/connections/${id}`);
      setConfirmRemove(null);
      showToast(t('exchange.removed'), { variant: 'success' });
      await load();
    } catch (error) {
      showToast(error?.message || t('exchange.removeFailed'), { variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  const connectedIds = new Set(connections.map((c) => c.exchange));
  const canAddMore = EXCHANGES.some((x) => x.available && !connectedIds.has(x.id));

  return (
    <article className="tableCard settingsCard">
      <div className="settingsCardHeader">
        <div>
          <h2>{t('exchange.title')}</h2>
          <p className="settingsCardDesc">{t('exchange.desc')}</p>
        </div>
        {canAddMore && (
          <button type="button" className="settingsPrimaryBtn" onClick={openConnect}>
            {t('exchange.connect')}
          </button>
        )}
      </div>

      {loading && <p className="settingsMuted">{t('app.loading')}</p>}
      {!loading && loadError && <p className="error">{loadError}</p>}
      {!loading && !loadError && connections.length === 0 && <p className="settingsMuted">{t('exchange.empty')}</p>}

      {!loading && !loadError && connections.length > 0 && (
        <ul className="exchangeConnList">
          {connections.map((c) => {
            const name = EXCHANGES.find((x) => x.id === c.exchange)?.name || c.exchange;
            return (
              <li key={c.exchange} className="exchangeConnRow">
                <div>
                  <strong>{name}</strong>{' '}
                  <span className="settingsBadge settingsBadgeActive">{t('exchange.readOnly')}</span>
                  <div className="settingsMuted exchangeConnMeta">
                    {t('exchange.keyEnding', { last4: c.keyLast4 })} · {t('exchange.lastChecked')}: {formatTs(c.lastSyncedAt, locale)}
                  </div>
                  {c.lastError && <div className="exchangeConnError">{c.lastError}</div>}
                  <Link className="exchangeViewLink" to="/portfolio?review=exchange">
                    {t('exchange.viewTrades')}
                  </Link>
                </div>
                <span className="positionInlineActions">
                  {confirmRemove === c.exchange ? (
                    <>
                      <button type="button" className="settingsDangerLink" onClick={() => handleRemove(c.exchange)} disabled={busy === `remove-${c.exchange}`}>
                        {t('exchange.confirmRemove')}
                      </button>
                      <button type="button" className="passkeyCancelBtn" onClick={() => setConfirmRemove(null)}>
                        {t('modals.cancel')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="headerIconBtn positionActionBtn"
                        onClick={() => handleCheck(c.exchange)}
                        disabled={busy === `check-${c.exchange}`}
                        aria-label={t('exchange.checkNow')}
                        title={t('exchange.checkNow')}
                      >
                        {busy === `check-${c.exchange}` ? '…' : '⟳'}
                      </button>
                      <button
                        type="button"
                        className="headerIconBtn positionActionBtn positionActionBtnDanger"
                        onClick={() => setConfirmRemove(c.exchange)}
                        aria-label={t('exchange.remove')}
                        title={t('exchange.remove')}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Portal: the card's backdrop-filter would otherwise trap the fixed overlay inside the card. */}
      {connectOpen && createPortal(
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="exchange-connect-title">
          <section className="modalCard">
            <header className="modalHeader">
              <h2 id="exchange-connect-title">{t('exchange.connectTitle')}</h2>
              <button type="button" className="modalCloseBtn" onClick={() => !saving && setConnectOpen(false)} aria-label={t('modals.close')}>
                ✕
              </button>
            </header>
            <form onSubmit={handleConnect}>
              <div className="modalBody">
                <div className="exchangeSeg" role="radiogroup" aria-label={t('exchange.exchange')}>
                  {EXCHANGES.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      role="radio"
                      aria-checked={exchange === x.id}
                      className={exchange === x.id ? 'on' : ''}
                      disabled={!x.available || connectedIds.has(x.id)}
                      onClick={() => setExchange(x.id)}
                    >
                      {x.name}
                      {!x.available ? ` · ${t('exchange.comingSoon')}` : ''}
                    </button>
                  ))}
                </div>
                <label className="modalLabel">
                  {t('exchange.apiKey')}
                  <input className="settingsInput" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} required />
                </label>
                <label className="modalLabel">
                  {t('exchange.secretKey')}
                  <input type="password" className="settingsInput" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} autoComplete="off" spellCheck={false} required />
                </label>
                <p className="settingsFieldHint">{t('exchange.binanceHowTo')}</p>
                {formError && <p className="error" role="alert">{formError}</p>}
              </div>
              <footer className="modalFooter">
                <button type="button" className="modalBtn secondary" onClick={() => setConnectOpen(false)} disabled={saving}>
                  {t('modals.cancel')}
                </button>
                <button type="submit" className="modalBtn" disabled={saving}>
                  {saving ? t('exchange.testing') : t('exchange.testAndSave')}
                </button>
              </footer>
            </form>
          </section>
        </div>,
        document.body,
      )}
    </article>
  );
}
