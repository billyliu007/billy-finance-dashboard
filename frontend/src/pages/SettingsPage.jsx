import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { deleteJson, fetchJson, postJson } from '../utils/api.js';

function formatTs(value, locale) {
  if (value == null || value === '') return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString(locale);
}

function toExpiresAtIso(datetimeLocal) {
  const v = String(datetimeLocal || '').trim();
  if (!v) return null;
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) {
    throw new Error('Invalid expiry date.');
  }
  if (d.getTime() <= Date.now()) {
    throw new Error('Expiry must be in the future.');
  }
  return d.toISOString();
}

export default function SettingsPage() {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';

  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [createLabel, setCreateLabel] = useState('');
  const [createExpires, setCreateExpires] = useState('');
  const [creating, setCreating] = useState(false);

  const [revealedToken, setRevealedToken] = useState(null);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revoking, setRevoking] = useState(false);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await fetchJson('/api/user/api-tokens');
      setTokens(Array.isArray(data?.tokens) ? data.tokens : []);
    } catch (e) {
      setLoadError(e?.message || t('settings.loadFailed'));
      setTokens([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  async function handleCreateSubmit(e) {
    e.preventDefault();
    setCreating(true);
    try {
      let expiresAt = null;
      if (createExpires.trim()) {
        expiresAt = toExpiresAtIso(createExpires);
      }
      const body = { label: createLabel.trim() || undefined, expiresAt };
      const created = await postJson('/api/user/api-tokens', body);
      setCreateOpen(false);
      setCreateLabel('');
      setCreateExpires('');
      if (created?.token) {
        setRevealedToken(created);
      }
      await loadTokens();
    } catch (err) {
      showToast(err?.message || t('settings.createFailed'), { variant: 'error' });
    } finally {
      setCreating(false);
    }
  }

  async function handleRevokeConfirm() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await deleteJson(`/api/user/api-tokens/${revokeTarget}`);
      showToast(t('settings.revokedOk'), { variant: 'success' });
      setRevokeTarget(null);
      await loadTokens();
    } catch (err) {
      showToast(err?.message || t('settings.revokeFailed'), { variant: 'error' });
    } finally {
      setRevoking(false);
    }
  }

  async function copyToken(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('settings.apiKeyCopied'), { variant: 'success' });
    } catch {
      showToast(t('settings.copyFailed'), { variant: 'error' });
    }
  }

  return (
    <section className="contentWrap">
      <header className="pageHeader">
        <h1>{t('settings.title')}</h1>
      </header>

      <div className="dashboardPanel">
        <article className="tableCard settingsCard">
          <div className="settingsCardHeader">
            <div>
              <h2>{t('settings.apiKeysTitle')}</h2>
              <p className="settingsCardDesc">{t('settings.apiKeysDesc')}</p>
            </div>
            <button
              type="button"
              className="settingsPrimaryBtn"
              onClick={() => setCreateOpen(true)}
            >
              {t('settings.createApiKey')}
            </button>
          </div>

          {loading && <p className="settingsMuted">{t('settings.loadingKeys')}</p>}
          {!loading && loadError && <p className="error">{loadError}</p>}

          {!loading && !loadError && tokens.length === 0 && (
            <p className="settingsMuted">{t('settings.noKeys')}</p>
          )}

          {!loading && !loadError && tokens.length > 0 && (
            <div className="tableWrap settingsTableWrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('settings.colLabel')}</th>
                    <th>{t('settings.colCreated')}</th>
                    <th>{t('settings.colLastUsed')}</th>
                    <th>{t('settings.colExpires')}</th>
                    <th>{t('settings.colStatus')}</th>
                    <th>{t('settings.colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((row) => {
                    const revoked = Boolean(row.revokedAt);
                    return (
                      <tr key={row.id}>
                        <td>{row.label || '—'}</td>
                        <td>{formatTs(row.createdAt, locale)}</td>
                        <td>{formatTs(row.lastUsedAt, locale)}</td>
                        <td>{formatTs(row.expiresAt, locale)}</td>
                        <td>
                          {revoked ? (
                            <span className="settingsBadge settingsBadgeRevoked">{t('settings.statusRevoked')}</span>
                          ) : (
                            <span className="settingsBadge settingsBadgeActive">{t('settings.statusActive')}</span>
                          )}
                        </td>
                        <td>
                          {!revoked && (
                            <button
                              type="button"
                              className="settingsDangerLink"
                              onClick={() => setRevokeTarget(row.id)}
                            >
                              {t('settings.revoke')}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>

      {createOpen && (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="settings-create-key-title">
          <section className="modalCard">
            <header className="modalHeader">
              <h2 id="settings-create-key-title">{t('settings.createModalTitle')}</h2>
              <button
                type="button"
                className="modalCloseBtn"
                onClick={() => !creating && setCreateOpen(false)}
                aria-label={t('modals.close')}
              >
                ✕
              </button>
            </header>
            <form onSubmit={handleCreateSubmit}>
              <div className="modalBody">
                <label className="modalLabel">
                  {t('settings.fieldLabel')}
                  <input
                    type="text"
                    className="settingsInput"
                    value={createLabel}
                    onChange={(e) => setCreateLabel(e.target.value)}
                    placeholder={t('settings.fieldLabelPlaceholder')}
                    maxLength={200}
                    autoComplete="off"
                  />
                </label>
                <label className="modalLabel">
                  {t('settings.fieldExpires')}
                  <input
                    type="datetime-local"
                    className="settingsInput"
                    value={createExpires}
                    onChange={(e) => setCreateExpires(e.target.value)}
                  />
                  <span className="settingsFieldHint">{t('settings.fieldExpiresHint')}</span>
                </label>
              </div>
              <footer className="modalFooter">
                <button
                  type="button"
                  className="modalBtn secondary"
                  onClick={() => setCreateOpen(false)}
                  disabled={creating}
                >
                  {t('modals.cancel')}
                </button>
                <button type="submit" className="modalBtn" disabled={creating}>
                  {creating ? t('settings.creating') : t('settings.createSubmit')}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {revealedToken && (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="settings-token-reveal-title">
          <section className="modalCard modalCard--wide">
            <header className="modalHeader">
              <h2 id="settings-token-reveal-title">{t('settings.revealTitle')}</h2>
              <button
                type="button"
                className="modalCloseBtn"
                onClick={() => setRevealedToken(null)}
                aria-label={t('modals.close')}
              >
                ✕
              </button>
            </header>
            <div className="modalBody">
              <p className="settingsRevealWarning">{t('settings.revealWarning')}</p>
              <pre className="settingsTokenBox">{revealedToken.token}</pre>
              <div className="settingsRevealActions">
                <button
                  type="button"
                  className="modalBtn"
                  onClick={() => copyToken(revealedToken.token)}
                >
                  {t('settings.copyToken')}
                </button>
              </div>
            </div>
            <footer className="modalFooter">
              <button type="button" className="modalBtn" onClick={() => setRevealedToken(null)}>
                {t('settings.done')}
              </button>
            </footer>
          </section>
        </div>
      )}

      {revokeTarget && (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="settings-revoke-title">
          <section className="modalCard">
            <header className="modalHeader">
              <h2 id="settings-revoke-title">{t('settings.revokeModalTitle')}</h2>
              <button
                type="button"
                className="modalCloseBtn"
                onClick={() => !revoking && setRevokeTarget(null)}
                aria-label={t('modals.close')}
              >
                ✕
              </button>
            </header>
            <div className="modalBody">
              <p>{t('settings.revokeModalBody')}</p>
            </div>
            <footer className="modalFooter">
              <button
                type="button"
                className="modalBtn secondary"
                onClick={() => setRevokeTarget(null)}
                disabled={revoking}
              >
                {t('modals.cancel')}
              </button>
              <button type="button" className="modalBtn danger" onClick={handleRevokeConfirm} disabled={revoking}>
                {revoking ? t('settings.revoking') : t('settings.revokeConfirm')}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
