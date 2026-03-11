import { useMemo, useState } from 'react';
import { API_BASE_URL } from '../constants.js';
import { postJson } from '../utils/api.js';
import { useLanguage } from '../contexts/LanguageContext.jsx';

function resolveMessage(search) {
  const params = new URLSearchParams(search);
  const message = params.get('message');
  return message ? decodeURIComponent(message) : '';
}

export default function LoginPage() {
  const { t } = useLanguage();
  const [isLoggingInDemo, setIsLoggingInDemo] = useState(false);
  const [demoError, setDemoError] = useState('');
  const message = useMemo(() => resolveMessage(window.location.search), []);
  const apiBase = String(API_BASE_URL || '').replace(/\/$/, '');
  const authHref = (provider) => `${apiBase}/api/auth/${provider}/start`;

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
        <h1>{t('login.title')}</h1>
        <p>{t('login.signInDesc')}</p>
        <div className="authActions">
          <a href={authHref('google')} className="authBtn">
            {t('login.continueGoogle')}
          </a>
          <a href={authHref('apple')} className="authBtn secondary">
            {t('login.continueApple')}
          </a>
          <a href={authHref('wechat')} className="authBtn secondary">
            {t('login.continueWechat')}
          </a>
          <button
            type="button"
            className="authBtn secondary"
            onClick={handleDemoLogin}
            disabled={isLoggingInDemo}
          >
            {isLoggingInDemo ? t('login.startingDemo') : t('login.loginDemo')}
          </button>
        </div>
        {message && <p className="error">{message}</p>}
        {demoError && <p className="error">{demoError}</p>}
        <p className="authHint">{t('login.demoHint')}</p>
      </section>
    </main>
  );
}
