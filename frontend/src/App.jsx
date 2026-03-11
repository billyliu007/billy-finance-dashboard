import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import SideNav from './components/SideNav.jsx';
import UserMenu from './components/UserMenu.jsx';
import { useLanguage } from './contexts/LanguageContext.jsx';
import { DashboardProvider } from './contexts/DashboardContext.jsx';
import { SHOW_DEVELOPMENT_PAGE } from './constants.js';
import NetWorthPage from './pages/NetWorthPage.jsx';
import PortfolioPage from './pages/PortfolioPage.jsx';
import DevelopmentPage from './pages/DevelopmentPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import OnboardingPage from './pages/OnboardingPage.jsx';
import { fetchJson, postJson } from './utils/api.js';
import { resolveFrontendBuildVersion } from './utils/version.js';
import './App.css';

function LoadingScreen() {
  const { t } = useLanguage();
  return (
    <main className="authScreen">
      <section className="authCard">
        <h1>My Worth Track</h1>
        <p>{t('app.checkingSession')}</p>
      </section>
    </main>
  );
}

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
      <LoadingScreen />
    );
  }

  if (!session.authenticated) {
    return <LoginPage />;
  }

  if (!session.user?.onboardingCompleted) {
    return <OnboardingPage onCompleted={refreshSession} />;
  }

  return (
    <DashboardProvider>
      <div className={`appShell${sideNavOpen ? '' : ' sideNavCollapsed'}`}>
        <SideNav
          open={sideNavOpen}
          onToggle={() => setSideNavOpen((prev) => !prev)}
        />

        <main className="mainContent">
          <div className="topBar">
            {session.error && <p className="error topBarError">{session.error}</p>}
            <UserMenu
              user={session.user}
              hideValues={hideValues}
              onHideValuesChange={setHideValues}
              onLogout={handleLogout}
            />
          </div>
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
    </DashboardProvider>
  );
}
