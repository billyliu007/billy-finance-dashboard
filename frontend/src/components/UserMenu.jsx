import { useEffect, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext.jsx';

function getInitials(name, email) {
  const source = name || email || '';
  const parts = String(source).trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function UserMenu({ user, onLogout }) {
  const { language, setLanguage, t } = useLanguage();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event) {
      if (event.target.closest('.userMenuButton, .userMenuPopover')) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const displayName = user?.displayName || user?.email || t('app.user');
  const initials = getInitials(user?.displayName, user?.email);

  return (
    <div className="userMenu">
      <button
        type="button"
        className="userMenuButton"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="userAvatar" aria-hidden="true">
          {initials}
        </span>
        <span className="userName">{displayName}</span>
      </button>
      {open && (
        <div className="userMenuPopover" role="menu">
          <div className="userMenuSection">
            <div className="userMenuLabel">{t('userMenu.language')}</div>
            <button
              type="button"
              className={`userMenuItem${language === 'en' ? ' active' : ''}`}
              onClick={() => setLanguage('en')}
            >
              {t('userMenu.english')}
            </button>
            <button
              type="button"
              className={`userMenuItem${language === 'zh' ? ' active' : ''}`}
              onClick={() => setLanguage('zh')}
            >
              {t('userMenu.chinese')}
            </button>
          </div>
          {/* Privacy mode toggle removed: always show full values. */}
          <div className="userMenuDivider" />
          <button
            type="button"
            className="userMenuItem danger"
            onClick={() => {
              setOpen(false);
              onLogout?.();
            }}
          >
            {t('userMenu.logOut')}
          </button>
        </div>
      )}
    </div>
  );
}
