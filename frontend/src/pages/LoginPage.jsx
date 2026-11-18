import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../constants.js';
import { fetchJson, postJson } from '../utils/api.js';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import {
  describePasskeyError,
  isPasskeyCancelled,
  isPasskeySupported,
  signInWithPasskey,
} from '../utils/passkeys.js';

function resolveMessage(search) {
  const params = new URLSearchParams(search);
  const message = params.get('message');
  return message ? decodeURIComponent(message) : '';
}

function parseProviders(data) {
  const list = Array.isArray(data?.providers) ? data.providers : [];
  const map = Object.fromEntries(list.map((p) => [p.key, Boolean(p.enabled)]));
  return {
    google: map.google === true,
    apple: map.apple === true,
    microsoft: map.microsoft === true,
    passkey: map.passkey === true && isPasskeySupported(),
  };
}

export default function LoginPage() {
  const { language, setLanguage, t } = useLanguage();
  const [isLoggingInDemo, setIsLoggingInDemo] = useState(false);
  const [demoError, setDemoError] = useState('');
  const [providers, setProviders] = useState(null);
  const [isPasskeySigningIn, setIsPasskeySigningIn] = useState(false);
  const [passkeyError, setPasskeyError] = useState('');
  const message = useMemo(() => resolveMessage(window.location.search), []);
  const apiBase = String(API_BASE_URL || '').replace(/\/$/, '');
  const authHref = (provider) => `${apiBase}/api/auth/${provider}/start`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJson('/api/auth/providers');
        if (!cancelled) setProviders(parseProviders(data));
      } catch {
        if (!cancelled) setProviders({ google: false, apple: false, microsoft: false, passkey: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handlePasskeyLogin() {
    try {
      setIsPasskeySigningIn(true);
      setPasskeyError('');
      await signInWithPasskey();
      window.location.assign('/');
    } catch (error) {
      if (!isPasskeyCancelled(error)) setPasskeyError(describePasskeyError(error, t));
      setIsPasskeySigningIn(false);
    }
  }

  async function handleDemoLogin() {
    try {
      setIsLoggingInDemo(true);
      setDemoError('');
      await postJson('/api/auth/demo', {});
      window.location.assign('/');
    } catch (error) {
      setDemoError(error?.message || 'Demo login failed.');
    } finally {
      setIsLoggingInDemo(false);
    }
  }

  return (
    <main className="authScreen">
      <section className="authCard">
        <div className="authCardHeader">
          <h1 className="authTitle">My Worth Track</h1>
          <div className="authLanguageSwitch" role="group" aria-label={t('userMenu.language')}>
            <button
              type="button"
              className={`authLangBtn${language === 'en' ? ' active' : ''}`}
              onClick={() => setLanguage('en')}
            >
              {t('userMenu.english')}
            </button>
            <span className="authLangSep">|</span>
            <button
              type="button"
              className={`authLangBtn${language === 'zh' ? ' active' : ''}`}
              onClick={() => setLanguage('zh')}
            >
              {t('userMenu.chinese')}
            </button>
          </div>
        </div>
        <p className="authIntro">{t('login.signInDesc')}</p>

        <div className="authSections">
          {providers && (providers.google || providers.microsoft || providers.apple || providers.passkey) ? (
            <section className="authSection">
              <p className="authSectionTitle">
                {language === 'zh' ? '使用账号登录' : 'Sign in with your account'}
              </p>
              <div className="authActions authActionsOAuth">
                {providers.google ? (
                  <a href={authHref('google')} className="authBtn authBtnProvider authBtnGoogle">
                    <span className="authBtnIcon" aria-hidden="true">
                      <img
                        src="https://www.gstatic.com/images/branding/product/1x/gsa_64dp.png"
                        alt=""
                      />
                    </span>
                    <span className="authBtnLabel">{t('login.continueGoogle')}</span>
                  </a>
                ) : null}
                {providers.microsoft ? (
                  <a href={authHref('microsoft')} className="authBtn authBtnProvider authBtnMicrosoft">
                    <span className="authBtnIcon" aria-hidden="true">
                      <svg viewBox="0 0 21 21" width="18" height="18" focusable="false">
                        <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                        <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                        <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                        <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                      </svg>
                    </span>
                    <span className="authBtnLabel">{t('login.continueMicrosoft')}</span>
                  </a>
                ) : null}
                {providers.apple ? (
                  <a href={authHref('apple')} className="authBtn authBtnProvider authBtnApple">
                    <span className="authBtnIcon authBtnAppleIcon" aria-hidden="true">
                      <span className="authAppleGlyph"></span>
                    </span>
                    <span className="authBtnLabel">{t('login.continueApple')}</span>
                  </a>
                ) : null}
                {providers.passkey ? (
                  <button
                    type="button"
                    className="authBtn authBtnProvider authBtnPasskey"
                    onClick={handlePasskeyLogin}
                    disabled={isPasskeySigningIn}
                  >
                    <span className="authBtnIcon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false">
                        <circle cx="9" cy="7" r="4" />
                        <path d="M2 21v-1a6 6 0 0 1 9.5-4.9" />
                        <circle cx="17.5" cy="14.5" r="2.5" />
                        <path d="M17.5 17v4.5l1.5-1.2M17.5 19.5l1.5-1" />
                      </svg>
                    </span>
                    <span className="authBtnLabel">
                      {isPasskeySigningIn ? t('passkeys.signingIn') : t('passkeys.signIn')}
                    </span>
                  </button>
                ) : null}
              </div>
              {passkeyError ? <p className="error authPasskeyError" role="alert">{passkeyError}</p> : null}
            </section>
          ) : null}
          {providers && !providers.google && !providers.microsoft && !providers.apple && !providers.passkey ? (
            <p className="authHint authOauthHint">{t('login.oauthNoneHint')}</p>
          ) : null}

          <section className="authSection authSectionDemo">
            <p className="authSectionTitle">
              {language === 'zh' ? '或试用演示账号' : 'Or explore the live demo'}
            </p>
            <div className="authActions authActionsDemo">
              <button
                type="button"
                className="authBtn secondary"
                onClick={handleDemoLogin}
                disabled={isLoggingInDemo}
              >
                {isLoggingInDemo ? t('login.startingDemo') : t('login.loginDemo')}
              </button>
            </div>
          </section>
        </div>
        {message && <p className="error">{message}</p>}
        {demoError && <p className="error">{demoError}</p>}
        <p className="authHint">{t('login.demoHint')}</p>
      </section>
    </main>
  );
}
