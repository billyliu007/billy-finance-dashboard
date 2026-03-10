import { useMemo } from 'react';
import { API_BASE_URL } from '../constants.js';

function resolveMessage(search) {
  const params = new URLSearchParams(search);
  const message = params.get('message');
  return message ? decodeURIComponent(message) : '';
}

export default function LoginPage() {
  const message = useMemo(() => resolveMessage(window.location.search), []);
  const apiBase = String(API_BASE_URL || '').replace(/\/$/, '');
  const authHref = (provider) => `${apiBase}/api/auth/${provider}/start`;
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
        </div>
        {message && <p className="error">{message}</p>}
      </section>
    </main>
  );
}
