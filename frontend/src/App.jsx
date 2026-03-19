import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import SideNav from './components/SideNav.jsx';
import UserMenu from './components/UserMenu.jsx';
import AiAnalysisFab from './components/AiAnalysisFab.jsx';
import { useLanguage } from './contexts/LanguageContext.jsx';
import LogoWordmark from './components/LogoWordmark.jsx';
import { DashboardProvider } from './contexts/DashboardContext.jsx';
import { SHOW_DEVELOPMENT_PAGE } from './constants.js';
import NetWorthPage from './pages/NetWorthPage.jsx';
import PortfolioPage from './pages/PortfolioPage.jsx';
import ProfitabilityPage from './pages/ProfitabilityPage.jsx';
import StrategySimulatorPage from './pages/StrategySimulatorPage.jsx';
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
  const { t } = useLanguage();
  const hideValues = false; // Privacy mode removed; always show full values.
  const [session, setSession] = useState({ isLoading: true, authenticated: false, user: null, error: '' });
  const [buildVersion] = useState(() => resolveFrontendBuildVersion());

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
    // Initial session state is already loading; avoid synchronous setState inside the effect body.
    (async () => {
      try {
        const response = await fetchJson('/api/auth/session');
        if (!response?.authenticated) {
          setSession({ isLoading: false, authenticated: false, user: null, error: '' });
          return;
        }
        setSession({ isLoading: false, authenticated: true, user: response.user, error: '' });
      } catch (error) {
        setSession({ isLoading: false, authenticated: false, user: null, error: error?.message || 'Auth check failed.' });
      }
    })();
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
      <div className="appShell">
        <header className="appHeader">
          <span className="appHeaderBrand">
            <LogoWordmark label={t('app.brand')} />
          </span>
          <UserMenu
            user={session.user}
            onLogout={handleLogout}
          />
        </header>
        <div className="appBody">
          <SideNav />
          <main className="mainContent">
            {session.error && <p className="error">{session.error}</p>}
            <Routes>
            <Route path="/login" element={<Navigate to="/net-worth" replace />} />
            <Route path="/onboarding" element={<Navigate to="/net-worth" replace />} />
            <Route path="/net-worth" element={<NetWorthPage hideValues={hideValues} />} />
            <Route path="/overview" element={<Navigate to="/net-worth" replace />} />
            <Route path="/portfolio" element={<PortfolioPage hideValues={hideValues} />} />
            <Route path="/trading-performance" element={<ProfitabilityPage hideValues={hideValues} />} />
            <Route path="/strategy-simulator" element={<StrategySimulatorPage hideValues={hideValues} />} />
            <Route path="/profitability" element={<Navigate to="/trading-performance" replace />} />
            {SHOW_DEVELOPMENT_PAGE && (
              <Route path="/development" element={<DevelopmentPage frontendVersion={buildVersion} />} />
            )}
            <Route path="*" element={<Navigate to="/net-worth" replace />} />
            </Routes>
          </main>
        </div>
        <AiAnalysisFab />
      </div>
    </DashboardProvider>
  );
}
