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
  const { language, setLanguage, t } = useLanguage();
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
        <div className="authCardHeader">
          <h1>My Worth Track</h1>
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
        <p>{t('login.signInDesc')}</p>
        <div className="authActions">
          <a href={authHref('google')} className="authBtn">
            {t('login.continueGoogle')}
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
