import { NavLink } from 'react-router-dom';
import { SHOW_DEVELOPMENT_PAGE } from '../constants.js';

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
  return (
    <aside
      className={`sideNav${open ? '' : ' sideNav--collapsed'}`}
      aria-hidden={!open}
    >
      <button
        type="button"
        className="sideNavToggle"
        onClick={onToggle}
        aria-label={open ? 'Hide navigation' : 'Show navigation'}
        title={open ? 'Hide panel' : 'Show panel'}
      >
        {open ? '◀' : '▶'}
      </button>
      {open && (
        <>
          <p className="sideTitle">My Worth Track</p>
          <p className="sideSubtitle">{user?.displayName || user?.email}</p>
          <label className="privacyToggle">
            <input
              type="checkbox"
              checked={hideValues}
              onChange={(e) => onHideValuesChange(e.target.checked)}
            />
            <span>Privacy Mode (Hide Amounts)</span>
          </label>
          <nav>
            <NavLink
              to="/net-worth"
              className={({ isActive }) => `navLink${isActive ? ' active' : ''}`}
            >
              Net Worth
            </NavLink>
            <NavLink
              to="/portfolio"
              className={({ isActive }) => `navLink${isActive ? ' active' : ''}`}
            >
              Portfolio Holdings
            </NavLink>
            {SHOW_DEVELOPMENT_PAGE && (
              <NavLink
                to="/development"
                className={({ isActive }) => `navLink${isActive ? ' active' : ''}`}
              >
                Development
              </NavLink>
            )}
          </nav>
          <button type="button" className="logoutBtn" onClick={onLogout}>
            Log out
          </button>
        </>
      )}
    </aside>
  );
}
