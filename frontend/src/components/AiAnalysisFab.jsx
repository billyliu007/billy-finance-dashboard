import { useEffect, useMemo, useRef, useState } from 'react';
import { useDashboard } from '../contexts/DashboardContext.jsx';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import useApiData from '../hooks/useApiData.js';
import { buildPrompt, buildAssetsSnapshotPrompt, buildTradingPerformancePrompt } from '../utils/aiPrompts.js';

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

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function startOfYearDateOnly() {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
}

function subtractMonthsDateOnly(dateOnly, months) {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export default function AiAnalysisFab() {
  const { netWorth, portfolio, isLoading } = useDashboard();
  const { language, t } = useLanguage();
  const [toast, setToast] = useState('');
  const [isCopying, setIsCopying] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showInlineHint, setShowInlineHint] = useState(false);
  const [promptType, setPromptType] = useState('evaluation'); // 'evaluation' | 'assets_snapshot' | 'trading_performance'
  const [tradingReviewTimeframe, setTradingReviewTimeframe] = useState('since'); // since | ytd | 1y
  const lastPromptTypeRef = useRef(null);
  const tradingReviewRange = useMemo(() => {
    const today = todayDateOnly();
    if (tradingReviewTimeframe === 'ytd') return { from: startOfYearDateOnly(), to: today };
    if (tradingReviewTimeframe === '1y') return { from: subtractMonthsDateOnly(today, 12), to: today };
    return { from: null, to: null };
  }, [tradingReviewTimeframe]);

  const tradingPerformancePath = useMemo(() => {
    const params = new URLSearchParams();
    if (tradingReviewRange.from) params.set('from', tradingReviewRange.from);
    if (tradingReviewRange.to) params.set('to', tradingReviewRange.to);
    const qs = params.toString();
    return qs ? `/api/trading-performance?${qs}` : '/api/trading-performance';
  }, [tradingReviewRange.from, tradingReviewRange.to]);

  const { data: tradingPerformance } = useApiData(tradingPerformancePath);

  const prompt = useMemo(() => {
    const cashComponents = netWorth?.overview?.cashComponents ?? [];
    const positions = portfolio?.tableRows ?? [];
    if (promptType === 'assets_snapshot') {
      return buildAssetsSnapshotPrompt({ cashComponents, positions, language });
    }
    if (promptType === 'trading_performance') {
      return buildTradingPerformancePrompt({
        analytics: tradingPerformance,
        language,
      });
    }
    return buildPrompt({ cashComponents, positions, language });
  }, [netWorth, portfolio, language, promptType, tradingPerformance]);

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

  const copyHint = promptType === 'assets_snapshot'
    ? t('ai.copyHintSnapshot')
    : promptType === 'trading_performance'
      ? t('ai.copyHintTradingPerformance')
      : t('ai.copyHintEvaluation');
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
                <button
                  type="button"
                  role="tab"
                  className={`aiPromptTab${promptType === 'trading_performance' ? ' active' : ''}`}
                  aria-selected={promptType === 'trading_performance'}
                  onClick={() => setPromptType('trading_performance')}
                >
                  <span className="aiPromptTabIcon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4 19V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M8 19v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M12 19v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M16 19V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M20 19V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="aiPromptTabLabel">{t('ai.tradingPerformanceReview')}</span>
                </button>
              </div>
              {promptType === 'trading_performance' && (
                <div className="aiReviewTimeframeRow">
                  <label htmlFor="ai-review-timeframe" className="aiReviewTimeframeLabel">
                    {t('ai.reviewTimeframe')}
                  </label>
                  <select
                    id="ai-review-timeframe"
                    className="aiReviewTimeframeSelect"
                    value={tradingReviewTimeframe}
                    onChange={(e) => setTradingReviewTimeframe(e.target.value)}
                  >
                    <option value="since">{t('profitability.sinceInception')}</option>
                    <option value="ytd">{t('profitability.ytd')}</option>
                    <option value="1y">{t('profitability.oneYear')}</option>
                  </select>
                </div>
              )}
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
