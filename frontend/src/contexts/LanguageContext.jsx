import { createContext, useCallback, useContext, useState } from 'react';
import { getStoredLanguage, setStoredLanguage, translate } from '../i18n/translations.js';

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(getStoredLanguage);

  const setLanguage = useCallback((lang) => {
    if (lang !== 'en' && lang !== 'zh') return;
    setLanguageState(lang);
    setStoredLanguage(lang);
  }, []);

  const t = useCallback(
    (key, vars) => translate(language, key, vars),
    [language]
  );

  const value = { language, setLanguage, t };
  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return ctx;
}
