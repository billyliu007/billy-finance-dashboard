import { NavLink } from 'react-router-dom';
import { SHOW_DEVELOPMENT_PAGE } from '../constants.js';
import { useLanguage } from '../contexts/LanguageContext.jsx';

/**
 * Collapsible sidebar navigation: branding, privacy toggle, main nav links, logout.
 */
export default function SideNav({
  open,
  onToggle,
  user,
  hideValues,
  onHideValuesChange,
  onLogout,
}) {
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
        <>
          <p className="sideTitle">{t('app.brand')}</p>
          <p className="sideSubtitle">{user?.displayName || user?.email}</p>
          <label className="privacyToggle">
            <input
              type="checkbox"
              checked={hideValues}
              onChange={(e) => onHideValuesChange(e.target.checked)}
            />
            <span>{t('nav.privacyMode')}</span>
          </label>
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
          <button type="button" className="logoutBtn" onClick={onLogout}>
            {t('nav.logOut')}
          </button>
        </>
      )}
    </aside>
  );
}
