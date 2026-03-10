import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import NetWorthPage from './pages/NetWorthPage.jsx';
import PortfolioPage from './pages/PortfolioPage.jsx';
import DevelopmentPage from './pages/DevelopmentPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import OnboardingPage from './pages/OnboardingPage.jsx';
import { SHOW_DEVELOPMENT_PAGE } from './constants.js';
import { fetchJson, postJson } from './utils/api.js';
import { resolveFrontendBuildVersion } from './utils/version.js';
import './App.css';

export default function App() {
  const [hideValues, setHideValues] = useState(() => {
    const saved = localStorage.getItem('hide_values_enabled');
    return saved === 'true';
  });
  const [sideNavOpen, setSideNavOpen] = useState(() => {
    const saved = localStorage.getItem('side_nav_open');
    return saved !== 'false';
  });
  const [session, setSession] = useState({ isLoading: true, authenticated: false, user: null, error: '' });
  const [buildVersion] = useState(() => resolveFrontendBuildVersion());

  useEffect(() => {
    localStorage.setItem('hide_values_enabled', String(hideValues));
  }, [hideValues]);

  useEffect(() => {
    localStorage.setItem('side_nav_open', String(sideNavOpen));
  }, [sideNavOpen]);

  async function refreshSession() {
    try {
      setSession((prev) => ({ ...prev, isLoading: true, error: '' }));
      const response = await fetchJson('/api/auth/session');
      if (!response?.authenticated) {
        setSession({ isLoading: false, authenticated: false, user: null, error: '' });
        return;
      }
      setSession({ isLoading: false, authenticated: true, user: response.user, error: '' });
    } catch (error) {
      setSession({ isLoading: false, authenticated: false, user: null, error: error?.message || 'Auth check failed.' });
    }
  }

  useEffect(() => {
    refreshSession();
  }, []);

  async function handleLogout() {
    try {
      await postJson('/api/auth/logout', {});
    } catch {
      // ignore logout error and clear UI session anyway
    }
    setSession({ isLoading: false, authenticated: false, user: null, error: '' });
  }

  if (session.isLoading) {
    return (
      <main className="authScreen">
        <section className="authCard">
          <h1>MyWorthTrack</h1>
          <p>Checking your session...</p>
        </section>
      </main>
    );
  }

  if (!session.authenticated) {
    return <LoginPage />;
  }

  if (!session.user?.onboardingCompleted) {
    return <OnboardingPage onCompleted={refreshSession} />;
  }

  return (
    <div className={`appShell${sideNavOpen ? '' : ' sideNavCollapsed'}`}>
      <aside className={`sideNav${sideNavOpen ? '' : ' sideNav--collapsed'}`} aria-hidden={!sideNavOpen}>
        <button
          type="button"
          className="sideNavToggle"
          onClick={() => setSideNavOpen((prev) => !prev)}
          aria-label={sideNavOpen ? 'Hide navigation' : 'Show navigation'}
          title={sideNavOpen ? 'Hide panel' : 'Show panel'}
        >
          {sideNavOpen ? '◀' : '▶'}
        </button>
        {sideNavOpen && (
          <>
            <p className="sideTitle">MyWorthTrack</p>
            <p className="sideSubtitle">{session.user.displayName || session.user.email}</p>
            <label className="privacyToggle">
              <input
                type="checkbox"
                checked={hideValues}
                onChange={(event) => setHideValues(event.target.checked)}
              />
              <span>Privacy Mode (Hide Amounts)</span>
            </label>
            <nav>
              <NavLink to="/net-worth" className={({ isActive }) => `navLink${isActive ? ' active' : ''}`}>
                Net Worth
              </NavLink>
              <NavLink to="/portfolio" className={({ isActive }) => `navLink${isActive ? ' active' : ''}`}>
                Portfolio Holdings
              </NavLink>
              {SHOW_DEVELOPMENT_PAGE && (
                <NavLink to="/development" className={({ isActive }) => `navLink${isActive ? ' active' : ''}`}>
                  Development
                </NavLink>
              )}
            </nav>
            <button type="button" className="logoutBtn" onClick={handleLogout}>
              Log out
            </button>
          </>
        )}
      </aside>

      <main className="mainContent">
        {session.error && <p className="error">{session.error}</p>}
        <Routes>
          <Route path="/login" element={<Navigate to="/net-worth" replace />} />
          <Route path="/onboarding" element={<Navigate to="/net-worth" replace />} />
          <Route path="/net-worth" element={<NetWorthPage hideValues={hideValues} />} />
          <Route path="/overview" element={<Navigate to="/net-worth" replace />} />
          <Route path="/portfolio" element={<PortfolioPage hideValues={hideValues} />} />
          {SHOW_DEVELOPMENT_PAGE && (
            <Route path="/development" element={<DevelopmentPage frontendVersion={buildVersion} />} />
          )}
          <Route path="*" element={<Navigate to="/net-worth" replace />} />
        </Routes>
      </main>
    </div>
  );
}
