import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import NetWorthPage from './pages/NetWorthPage';
import PortfolioPage from './pages/PortfolioPage';
import './App.css';

export default function App() {
  const [hideValues, setHideValues] = useState(() => {
    const saved = localStorage.getItem('hide_values_enabled');
    return saved === 'true';
  });

  useEffect(() => {
    localStorage.setItem('hide_values_enabled', String(hideValues));
  }, [hideValues]);

  return (
    <div className="appShell">
      <aside className="sideNav">
        <p className="sideTitle">Billy's Finance</p>
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
        </nav>
      </aside>

      <main className="mainContent">
        <Routes>
          <Route path="/net-worth" element={<NetWorthPage hideValues={hideValues} />} />
          <Route path="/overview" element={<Navigate to="/net-worth" replace />} />
          <Route path="/portfolio" element={<PortfolioPage hideValues={hideValues} />} />
          <Route path="*" element={<Navigate to="/net-worth" replace />} />
        </Routes>
      </main>
    </div>
  );
}
