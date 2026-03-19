import { NavLink } from 'react-router-dom';
import { SHOW_DEVELOPMENT_PAGE } from '../constants.js';
import { useLanguage } from '../contexts/LanguageContext.jsx';

/**
 * Tab-style navigation bar (same design across viewports).
 */
export default function SideNav() {
  const { t } = useLanguage();

  return (
    <aside className="sideNav" aria-label="Main navigation">
      <nav className="sideNavTabs">
        <NavLink
          to="/net-worth"
          className={({ isActive }) => `navLink${isActive ? ' active' : ''}`}
        >
          {t('nav.netWorth')}
        </NavLink>
        <NavLink
          to="/portfolio"
          className={({ isActive }) => `navLink${isActive ? ' active' : ''}`}
        >
          {t('nav.portfolioHoldings')}
        </NavLink>
        <NavLink
          to="/trading-performance"
          className={({ isActive }) => `navLink${isActive ? ' active' : ''}`}
        >
          {t('nav.tradingPerformance')}
        </NavLink>
        <NavLink
          to="/strategy-simulator"
          className={({ isActive }) => `navLink${isActive ? ' active' : ''}`}
        >
          {t('nav.strategySimulator')}
        </NavLink>
        {SHOW_DEVELOPMENT_PAGE && (
          <NavLink
            to="/development"
            className={({ isActive }) => `navLink${isActive ? ' active' : ''}`}
          >
            {t('nav.development')}
          </NavLink>
        )}
      </nav>
    </aside>
  );
}
