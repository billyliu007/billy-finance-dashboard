import { NavLink } from 'react-router-dom';
import { SHOW_DEVELOPMENT_PAGE } from '../constants.js';
import { useLanguage } from '../contexts/LanguageContext.jsx';

/**
 * Collapsible sidebar navigation: branding and main nav links.
 */
export default function SideNav({ open, onToggle }) {
  const { t } = useLanguage();

  return (
    <aside
      className={`sideNav${open ? '' : ' sideNav--collapsed'}`}
      aria-hidden={!open}
    >
      <button
        type="button"
        className="sideNavToggle"
        onClick={onToggle}
        aria-label={open ? t('nav.hideNav') : t('nav.showNav')}
        title={open ? t('nav.hidePanel') : t('nav.showPanel')}
      >
        {open ? '◀' : '▶'}
      </button>
      {open && (
        <nav>
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
            {SHOW_DEVELOPMENT_PAGE && (
              <NavLink
                to="/development"
                className={({ isActive }) => `navLink${isActive ? ' active' : ''}`}
              >
                {t('nav.development')}
              </NavLink>
            )}
          </nav>
      )}
    </aside>
  );
}
