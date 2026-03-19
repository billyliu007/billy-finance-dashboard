import { useEffect, useMemo, useRef, useState } from 'react';
import { useDashboard } from '../contexts/DashboardContext.jsx';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import { buildPrompt, buildAssetsSnapshotPrompt } from '../utils/aiPrompts.js';

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

const PROVIDER_WEB_URLS = {
  chatgpt: 'https://chat.openai.com/',
  gemini: 'https://gemini.google.com/app',
  grok: 'https://x.com/i/grok',
  deepseek: 'https://chat.deepseek.com/',
};

export default function AiAnalysisFab() {
  const { netWorth, portfolio, isLoading } = useDashboard();
  const { language, t } = useLanguage();
  const [toast, setToast] = useState('');
  const [isCopying, setIsCopying] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showInlineHint, setShowInlineHint] = useState(false);
  const [promptType, setPromptType] = useState('evaluation'); // 'evaluation' | 'assets_snapshot'
  const lastPromptTypeRef = useRef(null);

  const prompt = useMemo(() => {
    const cashComponents = netWorth?.overview?.cashComponents ?? [];
    const positions = portfolio?.tableRows ?? [];
    if (promptType === 'assets_snapshot') {
      return buildAssetsSnapshotPrompt({ cashComponents, positions, language });
    }
    return buildPrompt({ cashComponents, positions, language });
  }, [netWorth, portfolio, language, promptType]);

  function closeModal() {
    setIsModalOpen(false);
  }

  useEffect(() => {
    if (!isModalOpen) {
      lastPromptTypeRef.current = null;
      return;
    }
    if (lastPromptTypeRef.current == null) {
      lastPromptTypeRef.current = promptType;
      return;
    }
    if (lastPromptTypeRef.current === promptType) {
      return;
    }
    lastPromptTypeRef.current = promptType;
    (async () => {
      try {
        await copyToClipboard(prompt || '');
        setToast(t('ai.copiedToClipboard'));
        window.setTimeout(() => setToast(''), 1600);
      } catch (err) {
        setToast(err?.message || t('ai.copyFailed'));
        window.setTimeout(() => setToast(''), 2600);
      }
    })();
  }, [isModalOpen, promptType, prompt, t]);

  useEffect(() => {
    let hideHintTimeoutId;
    const showTimeoutId = window.setTimeout(() => {
      setShowInlineHint(true);
      hideHintTimeoutId = window.setTimeout(() => {
        setShowInlineHint(false);
      }, 6000);
    }, 15000);
    return () => {
      window.clearTimeout(showTimeoutId);
      if (hideHintTimeoutId) window.clearTimeout(hideHintTimeoutId);
    };
  }, []);

  async function handleCopyAndOpen(provider) {
    const target = provider || 'chatgpt';
    const baseUrl = PROVIDER_WEB_URLS[target] || PROVIDER_WEB_URLS.chatgpt;
    let href = baseUrl;
    if (target === 'chatgpt' && prompt) {
      try {
        href = `${PROVIDER_WEB_URLS.chatgpt}?q=${encodeURIComponent(prompt)}`;
      } catch {
        href = baseUrl;
      }
    }
    try {
      setIsCopying(true);
      await copyToClipboard(prompt);
      window.setTimeout(() => {
        window.open(href, '_blank', 'noopener,noreferrer');
      }, 350);
    } catch (err) {
      setToast(err?.message || t('ai.copyFailed'));
      window.setTimeout(() => setToast(''), 2600);
    } finally {
      setIsCopying(false);
    }
  }

  async function handleCopyAgain() {
    try {
      setIsCopying(true);
      await copyToClipboard(prompt);
      setToast(t('ai.copiedAgain'));
      window.setTimeout(() => setToast(''), 2000);
    } catch (err) {
      setToast(err?.message || t('ai.copyFailed'));
      window.setTimeout(() => setToast(''), 2600);
    } finally {
      setIsCopying(false);
    }
  }

  const copyHint = promptType === 'assets_snapshot' ? t('ai.copyHintSnapshot') : t('ai.copyHintEvaluation');
  const promptPreview = prompt || t('ai.noPromptAvailable');

  return (
    <div className="aiFabWrap" aria-live="polite">
      {toast && <div className="aiFabToast">{toast}</div>}
      {isModalOpen && (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={t('ai.title')}>
          <section className="modalCard aiModalCard">
            <header className="modalHeader">
              <h2>{t('ai.title')}</h2>
              <button
                type="button"
                className="modalCloseBtn"
                onClick={closeModal}
                aria-label={t('ai.close')}
              >
                ✕
              </button>
            </header>
            <div className="modalBody">
              <div className="aiPromptTabs" role="tablist" aria-label={t('ai.promptType')}>
                <button
                  type="button"
                  role="tab"
                  className={`aiPromptTab${promptType === 'evaluation' ? ' active' : ''}`}
                  aria-selected={promptType === 'evaluation'}
                  onClick={() => setPromptType('evaluation')}
                >
                  <span className="aiPromptTabIcon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M10.5 6.5H6.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M9.5 10H6.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M11.2 13.5H6.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M14.5 14.5l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <circle cx="13.5" cy="13.5" r="4.5" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  </span>
                  <span className="aiPromptTabLabel">{t('ai.portfolioEvaluation')}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`aiPromptTab${promptType === 'assets_snapshot' ? ' active' : ''}`}
                  aria-selected={promptType === 'assets_snapshot'}
                  onClick={() => setPromptType('assets_snapshot')}
                >
                  <span className="aiPromptTabIcon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M7 7h3l1.2-2h1.6L14 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="2" />
                      <path d="M17.2 10.2h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="aiPromptTabLabel">{t('ai.assetsSnapshot')}</span>
                </button>
              </div>
              <p className="aiPromptHint">{copyHint}</p>
              <p className="aiPromptPreviewLabel">{t('ai.promptPreview')}</p>
              <div className="aiPromptBoxWrap">
                <pre className="aiPromptBox" role="document">{promptPreview}</pre>
              </div>
              <p className="aiProviderLabel">{t('ai.chooseAi')}</p>
              <div className="aiProviderGrid">
                <button type="button" className="aiProviderBtn" onClick={() => handleCopyAndOpen('chatgpt')} disabled={isCopying}>
                  <span className="aiProviderIcon chatgpt">
                    <img src="https://www.google.com/s2/favicons?domain=chat.openai.com&sz=64" alt="" width={34} height={34} />
                  </span>
                  <span className="aiProviderMeta">
                    <span className="aiProviderName">ChatGPT</span>
                    <span className="aiProviderDesc">{t('ai.chatgptDesc')}</span>
                  </span>
                </button>
                <button type="button" className="aiProviderBtn" onClick={() => handleCopyAndOpen('gemini')} disabled={isCopying}>
                  <span className="aiProviderIcon gemini">
                    <img src="https://www.google.com/s2/favicons?domain=gemini.google.com&sz=64" alt="" width={34} height={34} />
                  </span>
                  <span className="aiProviderMeta">
                    <span className="aiProviderName">Gemini</span>
                    <span className="aiProviderDesc">{t('ai.geminiDesc')}</span>
                  </span>
                </button>
                <button type="button" className="aiProviderBtn" onClick={() => handleCopyAndOpen('grok')} disabled={isCopying}>
                  <span className="aiProviderIcon grok">
                    <img src="https://www.google.com/s2/favicons?domain=x.com&sz=64" alt="" width={34} height={34} />
                  </span>
                  <span className="aiProviderMeta">
                    <span className="aiProviderName">Grok</span>
                    <span className="aiProviderDesc">{t('ai.grokDesc')}</span>
                  </span>
                </button>
                <button type="button" className="aiProviderBtn" onClick={() => handleCopyAndOpen('deepseek')} disabled={isCopying}>
                  <span className="aiProviderIcon deepseek">
                    <img src="https://www.google.com/s2/favicons?domain=chat.deepseek.com&sz=64" alt="" width={34} height={34} />
                  </span>
                  <span className="aiProviderMeta">
                    <span className="aiProviderName">DeepSeek</span>
                    <span className="aiProviderDesc">{t('ai.deepseekDesc')}</span>
                  </span>
                </button>
              </div>
            </div>
            <footer className="modalFooter">
              <button type="button" className="modalBtn secondary" onClick={handleCopyAgain} disabled={isCopying}>
                {t('ai.copyAgain')}
              </button>
              <button type="button" className="modalBtn" onClick={closeModal}>
                {t('ai.close')}
              </button>
            </footer>
          </section>
        </div>
      )}
      <button
        type="button"
        className={`aiFab${showInlineHint && !isModalOpen ? ' aiFab--hintVisible' : ''}`}
        onClick={() => setIsModalOpen(true)}
        disabled={isLoading || isCopying}
        aria-label={t('ai.openAiOptions')}
        title={t('ai.openAiOptions')}
      >
        <span className="aiFabIcon" aria-hidden="true">✦</span>
        <span className="aiFabText">AI</span>
        {showInlineHint && !isModalOpen && (
          <span className="aiFabInlineHint">{t('ai.inlineHint')}</span>
        )}
      </button>
    </div>
  );
}
