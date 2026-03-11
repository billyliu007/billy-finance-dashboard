import { useMemo, useState } from 'react';
import { API_BASE_URL } from '../constants.js';
import { postJson } from '../utils/api.js';

function resolveMessage(search) {
  const params = new URLSearchParams(search);
  const message = params.get('message');
  return message ? decodeURIComponent(message) : '';
}

export default function LoginPage() {
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
        <h1>My Worth Track</h1>
        <p>Sign in to access your personal dashboard data.</p>
        <div className="authActions">
          <a href={authHref('google')} className="authBtn">
            Continue with Google
          </a>
          <a href={authHref('apple')} className="authBtn secondary">
            Continue with Apple
          </a>
          <a href={authHref('wechat')} className="authBtn secondary">
            Continue with WeChat
          </a>
          <button
            type="button"
            className="authBtn secondary"
            onClick={handleDemoLogin}
            disabled={isLoggingInDemo}
          >
            {isLoggingInDemo ? 'Starting demo...' : 'Login Demo Account'}
          </button>
        </div>
        {message && <p className="error">{message}</p>}
        {demoError && <p className="error">{demoError}</p>}
        <p className="authHint">
          Demo account is shared by all users and will start with onboarding the first time it is used.
        </p>
      </section>
    </main>
  );
}
