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
          <section className="authSection">
            <p className="authSectionTitle">
              {language === 'zh' ? '使用账号登录' : 'Sign in with your account'}
            </p>
            <div className="authActions authActionsOAuth">
              <a href={authHref('google')} className="authBtn authBtnProvider authBtnGoogle">
                <span className="authBtnIcon" aria-hidden="true">
                  <img
                    src="https://www.gstatic.com/images/branding/product/1x/gsa_64dp.png"
                    alt=""
                  />
                </span>
                <span className="authBtnLabel">{t('login.continueGoogle')}</span>
              </a>
              <a href={authHref('apple')} className="authBtn authBtnProvider authBtnApple authAppleHidden" aria-hidden="true">
                <span className="authBtnIcon authBtnAppleIcon" aria-hidden="true">
                  <span className="authAppleGlyph"></span>
                </span>
                <span className="authBtnLabel">{t('login.continueApple')}</span>
              </a>
            </div>
          </section>

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
