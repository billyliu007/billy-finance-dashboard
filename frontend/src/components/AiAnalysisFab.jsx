import { useEffect, useMemo, useState } from 'react';
import { useDashboard } from '../contexts/DashboardContext.jsx';
import { useLanguage } from '../contexts/LanguageContext.jsx';

function formatNumber(value, { maxFrac = 2 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '');
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: maxFrac }).format(num);
}

function formatMoneyUsd(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '');
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(num);
}

function formatPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '');
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for older browsers
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

function buildPrompt({ cashComponents, positions, language = 'en' }) {
  const now = new Date().toISOString();
  const isZh = language === 'zh';

  const cash = (cashComponents || [])
    .map((c) => ({
      name: String(c?.name || (isZh ? '现金' : 'Cash')).trim(),
      currency: String(c?.currency || 'USD').trim().toUpperCase(),
      balance: Number(c?.balance ?? 0),
    }))
    .filter((c) => c.name || c.currency);

  const cashAssets = cash.filter((c) => Number.isFinite(c.balance) && c.balance >= 0);
  const debts = cash.filter((c) => Number.isFinite(c.balance) && c.balance < 0);

  const rows = Array.isArray(positions) ? positions : [];
  const byClass = new Map();
  for (const row of rows) {
    const cls = String(row?.category || 'Other').trim() || 'Other';
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(row);
  }

  const lines = [];
  lines.push(isZh ? '你是一位专业的投资顾问与投资组合分析师。' : 'You are a professional investment advisor and portfolio analyst.');
  lines.push(isZh ? '请分析我的净资产与投资组合，并给出可执行的建议。' : 'Analyze my net worth and portfolio, and provide actionable suggestions.');
  lines.push('');
  lines.push(isZh ? '目标：' : 'Goals:');
  lines.push(isZh ? '- 评估集中度风险、资产配置与分散程度。' : '- Evaluate concentration risk, asset allocation, and diversification.');
  lines.push(isZh ? '- 逐个持仓给出建议：买入 / 持有 / 卖出（并说明理由）。' : '- Review each holding and recommend: BUY / HOLD / SELL (with reasoning).');
  lines.push(isZh ? '- 给出现金/债务管理与风险敞口的改进建议。' : '- Suggest improvements to cash/debt management and risk exposure.');
  lines.push(isZh ? '- 给出按优先级排序的行动计划，并说明后续应关注什么。' : '- Provide a prioritized action plan and what to monitor next.');
  lines.push('');
  lines.push(isZh ? `数据快照时间（UTC）：${now}` : `Data snapshot time (UTC): ${now}`);
  lines.push('');

  lines.push(isZh ? '## 现金（资产）' : '## Cash (assets)');
  if (cashAssets.length === 0) {
    lines.push(isZh ? '- （无）' : '- (none)');
  } else {
    for (const item of cashAssets) {
      lines.push(`- ${item.name}: ${formatNumber(item.balance)} ${item.currency}`);
    }
  }
  lines.push('');

  lines.push(isZh ? '## 债务（负债）' : '## Debt (liabilities)');
  if (debts.length === 0) {
    lines.push(isZh ? '- （无）' : '- (none)');
  } else {
    for (const item of debts) {
      lines.push(`- ${item.name}: ${formatNumber(item.balance)} ${item.currency}`);
    }
  }
  lines.push('');

  lines.push(isZh ? '## 持仓（按资产类别分组）' : '## Positions (grouped by asset class)');
  if (rows.length === 0) {
    lines.push(isZh ? '- （无）' : '- (none)');
  } else {
    for (const [cls, clsRows] of Array.from(byClass.entries())) {
      lines.push(`### ${cls}`);
      for (const p of clsRows) {
        lines.push(
          [
            `- ${p?.name ?? p?.symbol ?? (isZh ? '未知' : 'Unknown')}`,
            `symbol=${p?.symbol ?? ''}`,
            `qty=${formatNumber(p?.qty, { maxFrac: 8 })}`,
            `avgCost=${formatMoneyUsd(p?.purchasePrice)}`,
            `costBasis=${formatMoneyUsd(p?.totalPurchaseCost)}`,
            `marketPrice=${formatMoneyUsd(p?.currentPrice)}`,
            `marketValue=${formatMoneyUsd(p?.currentValue)}`,
            `weight=${formatPct(p?.weightPct)}`,
            `unrealizedPnL=${formatMoneyUsd(p?.pnl)}`,
            `unrealizedReturn=${formatPct(p?.pnlPct)}`,
          ].join(' | ')
        );
      }
      lines.push('');
    }
  }

  lines.push(isZh ? '## 输出格式' : '## Output format');
  lines.push(isZh ? '- 先给出简短总结（3-6条要点）。' : '- Start with a concise summary (3-6 bullets).');
  lines.push(isZh ? '- 然后用表格列出每个持仓的 买入/持有/卖出 建议与理由。' : '- Then provide a table with each holding and BUY/HOLD/SELL plus rationale.');
  lines.push(isZh ? '- 最后给出优先级最高的行动计划（Top 5）。' : '- Then provide a prioritized action plan (top 5).');

  return lines.join('\n');
}

const PROVIDER_WEB_URLS = {
  chatgpt: 'https://chat.openai.com/',
  gemini: 'https://gemini.google.com/app',
  grok: 'https://x.com/i/grok',
  deepseek: 'https://chat.deepseek.com/',
};

export default function AiAnalysisFab() {
  const { netWorth, portfolio, isLoading } = useDashboard();
  const { language } = useLanguage();
  const [toast, setToast] = useState('');
  const [isCopying, setIsCopying] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showInlineHint, setShowInlineHint] = useState(false);

  const prompt = useMemo(() => {
    const cashComponents = netWorth?.overview?.cashComponents ?? [];
    const positions = portfolio?.tableRows ?? [];
    return buildPrompt({ cashComponents, positions, language });
  }, [netWorth, portfolio, language]);

  function closeModal() {
    setIsModalOpen(false);
  }

  useEffect(() => {
    // One-time inline hint next to the AI button:
    // appear after ~15s, stay for ~6s, then disappear permanently.
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
      setToast(err?.message || (language === 'zh' ? '复制失败。' : 'Failed to copy.'));
      window.setTimeout(() => setToast(''), 2600);
    } finally {
      setIsCopying(false);
    }
  }

  async function handleCopyAgain() {
    try {
      setIsCopying(true);
      await copyToClipboard(prompt);
      setToast(language === 'zh' ? '已再次复制到剪贴板' : 'Copied again to clipboard');
      window.setTimeout(() => setToast(''), 2000);
    } catch (err) {
      setToast(err?.message || (language === 'zh' ? '复制失败。' : 'Failed to copy.'));
      window.setTimeout(() => setToast(''), 2600);
    } finally {
      setIsCopying(false);
    }
  }

  const copyHint = language === 'zh'
    ? '下方为将发送给 AI 的提示词，其中包含你的净资产、现金、债务和持仓明细。选择任一 AI 即可复制并打开其页面。在新标签页中粘贴：电脑端用 Ctrl+V 或 Cmd+V；手机端在输入框长按并选择「粘贴」。'
    : 'The prompt below includes your net worth, cash balances, debts, and position details so the AI can analyze your portfolio. Choose an AI to copy and open its chat. In the new tab, paste the prompt: on desktop use Ctrl+V or Cmd+V; on mobile, long-press in the input and tap Paste.';

  return (
    <div className="aiFabWrap" aria-live="polite">
      {toast && <div className="aiFabToast">{toast}</div>}
      {isModalOpen && (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={language === 'zh' ? 'AI 分析' : 'AI analysis'}>
          <section className="modalCard aiModalCard">
            <header className="modalHeader">
              <h2>{language === 'zh' ? '粘贴到 AI 开始分析' : 'Paste in AI to start analysis'}</h2>
              <button
                type="button"
                className="modalCloseBtn"
                onClick={closeModal}
                aria-label={language === 'zh' ? '关闭' : 'Close'}
              >
                ✕
              </button>
            </header>
            <div className="modalBody">
              <p className="aiPromptHint">{copyHint}</p>
              <div className="aiPromptBoxWrap">
                <pre className="aiPromptBox" role="document">{prompt}</pre>
              </div>
              <p className="aiProviderLabel">{language === 'zh' ? '选择 AI 助手' : 'Choose AI assistant'}</p>
              <div className="aiProviderGrid">
                <button
                  type="button"
                  className="aiProviderBtn"
                  onClick={() => handleCopyAndOpen('chatgpt')}
                  disabled={isCopying}
                >
                  <span className="aiProviderIcon chatgpt">
                    <img src="https://www.google.com/s2/favicons?domain=chat.openai.com&sz=64" alt="" width={34} height={34} />
                  </span>
                  <span className="aiProviderMeta">
                    <span className="aiProviderName">ChatGPT</span>
                    <span className="aiProviderDesc">
                      {language === 'zh' ? 'OpenAI 聊天助手' : 'OpenAI chat assistant'}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="aiProviderBtn"
                  onClick={() => handleCopyAndOpen('gemini')}
                  disabled={isCopying}
                >
                  <span className="aiProviderIcon gemini">
                    <img src="https://www.google.com/s2/favicons?domain=gemini.google.com&sz=64" alt="" width={34} height={34} />
                  </span>
                  <span className="aiProviderMeta">
                    <span className="aiProviderName">Gemini</span>
                    <span className="aiProviderDesc">
                      {language === 'zh' ? 'Google Gemini 聊天' : 'Google Gemini chat'}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="aiProviderBtn"
                  onClick={() => handleCopyAndOpen('grok')}
                  disabled={isCopying}
                >
                  <span className="aiProviderIcon grok">
                    <img src="https://www.google.com/s2/favicons?domain=x.com&sz=64" alt="" width={34} height={34} />
                  </span>
                  <span className="aiProviderMeta">
                    <span className="aiProviderName">Grok</span>
                    <span className="aiProviderDesc">
                      {language === 'zh' ? 'X (Twitter) Grok 助手' : 'Grok on X (Twitter)'}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="aiProviderBtn"
                  onClick={() => handleCopyAndOpen('deepseek')}
                  disabled={isCopying}
                >
                  <span className="aiProviderIcon deepseek">
                    <img src="https://www.google.com/s2/favicons?domain=chat.deepseek.com&sz=64" alt="" width={34} height={34} />
                  </span>
                  <span className="aiProviderMeta">
                    <span className="aiProviderName">DeepSeek</span>
                    <span className="aiProviderDesc">
                      {language === 'zh' ? 'DeepSeek 投资分析' : 'DeepSeek investment analysis'}
                    </span>
                  </span>
                </button>
              </div>
            </div>
            <footer className="modalFooter">
              <button
                type="button"
                className="modalBtn secondary"
                onClick={handleCopyAgain}
                disabled={isCopying}
              >
                {language === 'zh' ? '再次复制' : 'Copy again'}
              </button>
              <button type="button" className="modalBtn" onClick={closeModal}>
                {language === 'zh' ? '关闭' : 'Close'}
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
        aria-label={language === 'zh' ? '打开 AI 分析选项' : 'Open AI analysis options'}
        title={language === 'zh' ? '打开 AI 分析选项' : 'Open AI analysis options'}
      >
        <span className="aiFabIcon" aria-hidden="true">✦</span>
        <span className="aiFabText">AI</span>
        {showInlineHint && !isModalOpen && (
          <span className="aiFabInlineHint">
            {language === 'zh'
              ? '用 AI 快速评估你的整个投资组合'
              : 'Use AI to quickly evaluate your full portfolio'}
          </span>
        )}
      </button>
    </div>
  );
}

