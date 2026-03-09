import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import NetWorthPage from './pages/NetWorthPage.jsx';
import PortfolioPage from './pages/PortfolioPage.jsx';
import DevelopmentPage from './pages/DevelopmentPage.jsx';
import { APP_PASSCODE, IS_APP_PASSCODE_VALID, SHOW_DEVELOPMENT_PAGE } from './constants.js';
import { resolveFrontendBuildVersion } from './utils/version.js';
import './App.css';

const SESSION_UNLOCK_KEY = 'app_passcode_unlocked';

export default function App() {
  const lockScreenRef = useRef(null);
  const [hideValues, setHideValues] = useState(() => {
    const saved = localStorage.getItem('hide_values_enabled');
    return saved === 'true';
  });
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(() => {
    if (!IS_APP_PASSCODE_VALID) {
      return true;
    }
    return sessionStorage.getItem(SESSION_UNLOCK_KEY) === 'true';
  });
  const [buildVersion] = useState(() => resolveFrontendBuildVersion());

  useEffect(() => {
    localStorage.setItem('hide_values_enabled', String(hideValues));
  }, [hideValues]);

  useEffect(() => {
    if (!isUnlocked) {
      lockScreenRef.current?.focus();
    }
  }, [isUnlocked]);

  function tryUnlock(nextInput) {
    if (!IS_APP_PASSCODE_VALID) {
      return;
    }
    if (nextInput === APP_PASSCODE) {
      setIsUnlocked(true);
      sessionStorage.setItem(SESSION_UNLOCK_KEY, 'true');
      setPasscodeError('');
      setPasscodeInput('');
      return;
    }
    if (nextInput.length === 4) {
      setPasscodeError('Incorrect passcode.');
      setPasscodeInput('');
    }
  }

  function handleDigitPress(digit) {
    if (passcodeInput.length >= 4) {
      return;
    }
    const nextInput = `${passcodeInput}${digit}`.slice(0, 4);
    setPasscodeInput(nextInput);
    if (passcodeError) {
      setPasscodeError('');
    }
    if (nextInput.length === 4) {
      tryUnlock(nextInput);
    }
  }

  function handleDeletePress() {
    if (passcodeInput.length === 0) {
      return;
    }
    setPasscodeInput(passcodeInput.slice(0, -1));
    if (passcodeError) {
      setPasscodeError('');
    }
  }

  function handleLockScreenKeyDown(event) {
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      handleDigitPress(event.key);
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      handleDeletePress();
    }
  }

  if (!isUnlocked) {
    return (
      <main className="lockScreen" onKeyDown={handleLockScreenKeyDown} tabIndex={0} ref={lockScreenRef}>
        <section className="lockCard">
          <h1>Billy&apos;s Finance</h1>
          <p>Enter Passcode</p>
          <div className="lockDots" aria-label="Passcode input status">
            {['d1', 'd2', 'd3', 'd4'].map((dot, index) => (
              <span key={dot} className={`lockDot${index < passcodeInput.length ? ' filled' : ''}`} />
            ))}
          </div>
          <div className="lockKeypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button key={digit} type="button" className="keypadButton" onClick={() => handleDigitPress(digit)}>
                {digit}
              </button>
            ))}
            <button type="button" className="keypadButton ghost" disabled />
            <button type="button" className="keypadButton" onClick={() => handleDigitPress('0')}>
              0
            </button>
            <button type="button" className="keypadButton action" onClick={handleDeletePress}>
              Delete
            </button>
          </div>
          {passcodeError && <p className="error">{passcodeError}</p>}
        </section>
      </main>
    );
  }

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
          {SHOW_DEVELOPMENT_PAGE && (
            <NavLink to="/development" className={({ isActive }) => `navLink${isActive ? ' active' : ''}`}>
              Development
            </NavLink>
          )}
        </nav>
      </aside>

      <main className="mainContent">
        <Routes>
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
