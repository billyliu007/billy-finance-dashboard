import { useMemo, useState } from 'react';
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

export default function AiAnalysisFab() {
  const { netWorth, portfolio, isLoading } = useDashboard();
  const { language } = useLanguage();
  const [toast, setToast] = useState('');
  const [isCopying, setIsCopying] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const prompt = useMemo(() => {
    const cashComponents = netWorth?.overview?.cashComponents ?? [];
    const positions = portfolio?.tableRows ?? [];
    return buildPrompt({ cashComponents, positions, language });
  }, [netWorth, portfolio, language]);

  async function handleCopyAndOpen(provider) {
    const target = provider || 'chatgpt';
    const providerMap = {
      chatgpt: 'https://chat.openai.com/',
      gemini: 'https://gemini.google.com/app',
      grok: 'https://x.com/i/grok',
      deepseek: 'https://chat.deepseek.com/',
    };
    const href = providerMap[target] || providerMap.chatgpt;

    try {
      setIsCopying(true);
      await copyToClipboard(prompt);
      setToast(
        language === 'zh'
          ? '已复制提示词到剪贴板，请在新打开的 AI 聊天窗口中粘贴。'
          : 'Prompt copied to clipboard. Paste it into the new AI chat window.',
      );
      window.setTimeout(() => setToast(''), 2200);
      window.open(href, '_blank', 'noopener,noreferrer');
      setIsModalOpen(false);
    } catch (err) {
      setToast(err?.message || (language === 'zh' ? '复制失败。' : 'Failed to copy.'));
      window.setTimeout(() => setToast(''), 2600);
    } finally {
      setIsCopying(false);
    }
  }

  return (
    <div className="aiFabWrap" aria-live="polite">
      {toast && <div className="aiFabToast">{toast}</div>}
      {isModalOpen && (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={language === 'zh' ? '选择 AI 助手' : 'Choose AI assistant'}>
          <section className="modalCard aiModalCard">
            <header className="modalHeader">
              <h2>{language === 'zh' ? '选择 AI 助手' : 'Choose AI assistant'}</h2>
              <button
                type="button"
                className="modalCloseBtn"
                onClick={() => setIsModalOpen(false)}
                aria-label={language === 'zh' ? '关闭' : 'Close'}
              >
                ✕
              </button>
            </header>
            <div className="modalBody aiProviderGrid">
              <button
                type="button"
                className="aiProviderBtn"
                onClick={() => handleCopyAndOpen('chatgpt')}
                disabled={isCopying}
              >
                <span className="aiProviderIcon chatgpt">GPT</span>
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
                <span className="aiProviderIcon gemini">G</span>
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
                <span className="aiProviderIcon grok">GX</span>
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
                <span className="aiProviderIcon deepseek">DS</span>
                <span className="aiProviderMeta">
                  <span className="aiProviderName">DeepSeek</span>
                  <span className="aiProviderDesc">
                    {language === 'zh' ? 'DeepSeek 投资分析' : 'DeepSeek investment analysis'}
                  </span>
                </span>
              </button>
            </div>
            <footer className="modalFooter">
              <button
                type="button"
                className="modalBtn secondary"
                onClick={() => setIsModalOpen(false)}
                disabled={isCopying}
              >
                {language === 'zh' ? '取消' : 'Cancel'}
              </button>
            </footer>
          </section>
        </div>
      )}
      <button
        type="button"
        className="aiFab"
        onClick={() => setIsModalOpen(true)}
        disabled={isLoading || isCopying}
        aria-label={language === 'zh' ? '打开 AI 分析选项' : 'Open AI analysis options'}
        title={language === 'zh' ? '打开 AI 分析选项' : 'Open AI analysis options'}
      >
        <span className="aiFabIcon" aria-hidden="true">✦</span>
        <span className="aiFabText">AI</span>
      </button>
    </div>
  );
}

