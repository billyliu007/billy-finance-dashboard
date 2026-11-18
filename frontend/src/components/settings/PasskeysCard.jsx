import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import {
  describePasskeyError,
  isPasskeyCancelled,
  isPasskeySupported,
  listPasskeys,
  registerPasskey,
  removePasskey,
} from '../../utils/passkeys.js';

function formatTs(value, locale) {
  if (value == null || value === '') return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString(locale);
}

/** Settings → Passkeys: add a passkey to this account, list and remove existing ones. */
export default function PasskeysCard() {
  const { language, t } = useLanguage();
  const { showToast } = useToast();
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const supported = isPasskeySupported();
  const [passkeys, setPasskeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [actionError, setActionError] = useState('');
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);
  const [removingId, setRemovingId] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoadError('');
      setPasskeys(await listPasskeys());
    } catch (error) {
      setLoadError(error?.message || t('passkeys.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd() {
    try {
      setIsAdding(true);
      setActionError('');
      await registerPasskey();
      showToast(t('passkeys.added'));
      await load();
    } catch (error) {
      if (!isPasskeyCancelled(error)) setActionError(describePasskeyError(error, t));
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRemove(id) {
    try {
      setRemovingId(id);
      setActionError('');
      await removePasskey(id);
      setConfirmRemoveId(null);
      await load();
    } catch (error) {
      setActionError(error?.message || t('passkeys.errors.passkey_failed'));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <article className="tableCard settingsCard">
      <div className="settingsCardHeader">
        <div>
          <h2>{t('passkeys.title')}</h2>
          <p className="settingsCardDesc">{t('passkeys.desc')}</p>
        </div>
        {supported ? (
          <button type="button" className="settingsPrimaryBtn" onClick={handleAdd} disabled={isAdding}>
            {isAdding ? t('passkeys.adding') : t('passkeys.add')}
          </button>
        ) : null}
      </div>

      {!supported && <p className="settingsMuted">{t('passkeys.unsupported')}</p>}
      {actionError && <p className="error" role="alert">{actionError}</p>}
      {loading && <p className="settingsMuted">{t('passkeys.loading')}</p>}
      {!loading && loadError && <p className="error">{loadError}</p>}
      {!loading && !loadError && passkeys.length === 0 && (
        <p className="settingsMuted">{t('passkeys.empty')}</p>
      )}

      {!loading && !loadError && passkeys.length > 0 && (
        <div className="tableWrap settingsTableWrap">
          <table>
            <thead>
              <tr>
                <th>{t('passkeys.colName')}</th>
                <th>{t('passkeys.colCreated')}</th>
                <th>{t('passkeys.colLastUsed')}</th>
                <th>{t('passkeys.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {passkeys.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.name}
                    {row.synced ? <span className="settingsBadge settingsBadgeActive passkeySyncedBadge">{t('passkeys.synced')}</span> : null}
                  </td>
                  <td>{formatTs(row.createdAt, locale)}</td>
                  <td>{formatTs(row.lastUsedAt, locale)}</td>
                  <td>
                    {confirmRemoveId === row.id ? (
                      <span className="passkeyConfirm">
                        <button
                          type="button"
                          className="settingsDangerLink"
                          onClick={() => handleRemove(row.id)}
                          disabled={removingId === row.id}
                        >
                          {removingId === row.id ? t('passkeys.removing') : t('passkeys.confirmRemove')}
                        </button>
                        <button type="button" className="passkeyCancelBtn" onClick={() => setConfirmRemoveId(null)}>
                          {t('modals.cancel')}
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="settingsDangerLink" onClick={() => setConfirmRemoveId(row.id)}>
                        {t('passkeys.remove')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
