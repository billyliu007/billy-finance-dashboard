import { useMemo } from 'react';

function resolveMessage(search) {
  const params = new URLSearchParams(search);
  const message = params.get('message');
  return message ? decodeURIComponent(message) : '';
}

export default function LoginPage() {
  const message = useMemo(() => resolveMessage(window.location.search), []);
  return (
    <main className="authScreen">
      <section className="authCard">
        <h1>NetPulse</h1>
        <p>Sign in to access your personal dashboard data.</p>
        <div className="authActions">
          <a href="/api/auth/google/start" className="authBtn">
            Continue with Google
          </a>
          <a href="/api/auth/apple/start" className="authBtn secondary">
            Continue with Apple
          </a>
          <a href="/api/auth/wechat/start" className="authBtn secondary">
            Continue with WeChat
          </a>
        </div>
        {message && <p className="error">{message}</p>}
      </section>
    </main>
  );
}
