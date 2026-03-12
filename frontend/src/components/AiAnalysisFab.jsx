import { useMemo, useState } from 'react';
import { useDashboard } from '../contexts/DashboardContext.jsx';

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

function buildPrompt({ cashComponents, positions }) {
  const now = new Date().toISOString();

  const cash = (cashComponents || [])
    .map((c) => ({
      name: String(c?.name || 'Cash').trim(),
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
  lines.push('You are a professional investment advisor and portfolio analyst.');
  lines.push('Analyze my net worth and portfolio, and provide actionable suggestions.');
  lines.push('');
  lines.push('Goals:');
  lines.push('- Evaluate concentration risk, asset allocation, and diversification.');
  lines.push('- Review each holding and recommend: BUY / HOLD / SELL (with reasoning).');
  lines.push('- Suggest improvements to cash/debt management and risk exposure.');
  lines.push('- Provide a prioritized action plan and what to monitor next.');
  lines.push('');
  lines.push(`Data snapshot time (UTC): ${now}`);
  lines.push('');

  lines.push('## Cash (assets)');
  if (cashAssets.length === 0) {
    lines.push('- (none)');
  } else {
    for (const item of cashAssets) {
      lines.push(`- ${item.name}: ${formatNumber(item.balance)} ${item.currency}`);
    }
  }
  lines.push('');

  lines.push('## Debt (liabilities)');
  if (debts.length === 0) {
    lines.push('- (none)');
  } else {
    for (const item of debts) {
      lines.push(`- ${item.name}: ${formatNumber(item.balance)} ${item.currency}`);
    }
  }
  lines.push('');

  lines.push('## Positions (grouped by asset class)');
  if (rows.length === 0) {
    lines.push('- (none)');
  } else {
    for (const [cls, clsRows] of Array.from(byClass.entries())) {
      lines.push(`### ${cls}`);
      for (const p of clsRows) {
        lines.push(
          [
            `- ${p?.name ?? p?.symbol ?? 'Unknown'}`,
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

  lines.push('## Output format');
  lines.push('- Start with a concise summary (3-6 bullets).');
  lines.push('- Then provide a table with each holding and BUY/HOLD/SELL plus rationale.');
  lines.push('- Then provide a prioritized action plan (top 5).');

  return lines.join('\n');
}

export default function AiAnalysisFab() {
  const { netWorth, portfolio, isLoading } = useDashboard();
  const [toast, setToast] = useState('');
  const [isCopying, setIsCopying] = useState(false);

  const prompt = useMemo(() => {
    const cashComponents = netWorth?.overview?.cashComponents ?? [];
    const positions = portfolio?.tableRows ?? [];
    return buildPrompt({ cashComponents, positions });
  }, [netWorth, portfolio]);

  async function handleClick() {
    try {
      setIsCopying(true);
      await copyToClipboard(prompt);
      setToast('AI prompt copied to clipboard.');
      window.setTimeout(() => setToast(''), 2200);
    } catch (err) {
      setToast(err?.message || 'Failed to copy.');
      window.setTimeout(() => setToast(''), 2600);
    } finally {
      setIsCopying(false);
    }
  }

  return (
    <div className="aiFabWrap" aria-live="polite">
      {toast && <div className="aiFabToast">{toast}</div>}
      <button
        type="button"
        className="aiFab"
        onClick={handleClick}
        disabled={isLoading || isCopying}
        aria-label="Copy AI analysis prompt"
        title="Copy AI analysis prompt"
      >
        <span className="aiFabIcon" aria-hidden="true">✦</span>
        <span className="aiFabText">AI</span>
      </button>
    </div>
  );
}

