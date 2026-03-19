/**
 * Pure helpers for building AI analysis prompts. Used by AiAnalysisFab.
 */

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

function formatMoney(value, currency = 'USD') {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '');
  const cur = String(currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(num);
  } catch {
    return `${formatNumber(num)} ${cur}`;
  }
}

function formatAmountWithCode(value, currency = 'USD', { maxFrac = 2 } = {}) {
  const cur = String(currency || 'USD').toUpperCase();
  return `${formatNumber(value, { maxFrac })} ${cur}`;
}

function formatPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '');
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

/**
 * Build evaluation prompt (net worth + portfolio analysis with BUY/HOLD/SELL).
 * @param {{ cashComponents: unknown[]; positions: unknown[]; language?: string }} opts
 * @returns {string}
 */
export function buildPrompt({ cashComponents, positions, language = 'en' }) {
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

  lines.push(isZh ? '## 持仓（按资产类别分组）' : '## Holdings (grouped by asset class)');
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

/**
 * Build assets-only snapshot prompt (no debt, for record-keeping).
 * @param {{ cashComponents: unknown[]; positions: unknown[]; language?: string }} opts
 * @returns {string}
 */
export function buildAssetsSnapshotPrompt({ cashComponents, positions, language = 'en' }) {
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

  const rows = Array.isArray(positions) ? positions : [];
  const byClass = new Map();
  for (const row of rows) {
    const cls = String(row?.category || 'Other').trim() || 'Other';
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(row);
  }

  const lines = [];
  lines.push(isZh ? '以下是我的资产快照（仅供记录）。' : 'Below is a snapshot of my assets (for record-keeping only).');
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

  lines.push(isZh ? '## 持仓（按资产类别分组）' : '## Holdings (grouped by asset class)');
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

  return lines.join('\n');
}

/**
 * Build trading performance expert review prompt.
 * @param {{ analytics: any; language?: string }} opts
 * @returns {string}
 */
export function buildTradingPerformancePrompt({ analytics, language = 'en' }) {
  const now = new Date().toISOString();
  const isZh = language === 'zh';
  const summary = analytics?.summary ?? {};
  const winStats = summary?.winStats ?? {};
  const attribution = analytics?.realizedAttribution ?? {};
  const monthly = analytics?.timeSeries?.realizedMonthly ?? [];
  const bestTrades = analytics?.trades?.best ?? [];
  const worstTrades = analytics?.trades?.worst ?? [];
  const insights = analytics?.insights ?? [];
  const tradeHistogram = analytics?.trades?.distributions?.tradeReturnHistogram ?? [];
  const selectedRange = analytics?.range ?? {};
  const allTrades = analytics?.trades?.all ?? [];
  const localPnlBySymbol = new Map();
  for (const tr of allTrades) {
    const sym = String(tr?.symbol || '').toUpperCase();
    if (!sym) continue;
    const currency = String(tr?.currency || 'USD').toUpperCase();
    const existing = localPnlBySymbol.get(sym) || { pnl: 0, currency };
    existing.pnl += Number(tr?.pnl) || 0;
    existing.currency = existing.currency || currency;
    localPnlBySymbol.set(sym, existing);
  }
  const lines = [];
  lines.push(
    isZh
      ? '你是一位资深交易绩效评审专家。请基于以下已实现交易数据进行专业复盘。'
      : 'You are a senior trading performance reviewer. Analyze the realized trading data below and provide a professional review.'
  );
  lines.push(
    isZh
      ? '请重点关注：收益质量、风险控制、交易一致性、归因结构、可执行改进方案。'
      : 'Focus on: quality of returns, risk control, trade consistency, attribution structure, and actionable improvements.'
  );
  lines.push(
    isZh
      ? '说明：统计口径（胜率、盈亏比、归因等）在后台已统一折算为 USD；但交易明细金额按资产原币种展示（如 USDT/USDC/USD）。'
      : 'Note: aggregate stats (win rate, profit factor, attribution, etc.) are USD-normalized in backend; trade-level details are shown in original asset currency (e.g., USDT/USDC/USD).'
  );
  lines.push('');
  lines.push(isZh ? `数据快照时间（UTC）：${now}` : `Data snapshot time (UTC): ${now}`);
  lines.push(
    isZh
      ? `分析区间：from=${selectedRange?.from || 'N/A'} | to=${selectedRange?.to || 'N/A'}`
      : `Analysis range: from=${selectedRange?.from || 'N/A'} | to=${selectedRange?.to || 'N/A'}`
  );
  lines.push('');

  lines.push(isZh ? '## 核心绩效指标（已实现）' : '## Core realized performance metrics');
  lines.push(
    isZh
      ? `- realizedPnL(数值，未附币种避免基准货币误导)=${formatNumber(summary?.realized?.pnl)}`
      : `- realizedPnL(USD-normalized)=${formatAmountWithCode(summary?.realized?.pnl, 'USD')}`
  );
  lines.push(`- winRate=${formatPct(winStats?.winRate)}`);
  lines.push(`- profitFactor=${formatNumber(winStats?.profitFactor, { maxFrac: 3 })}`);
  lines.push(`- avgWin(amount)=${formatNumber(winStats?.avgWin)}`);
  lines.push(`- avgLoss(amount)=${formatNumber(winStats?.avgLoss)}`);
  lines.push('');

  lines.push(isZh ? '## 收益归因（已实现）' : '## Realized attribution');
  lines.push(isZh ? '### 按资产类别' : '### By asset class');
  for (const row of attribution?.byAssetClass ?? []) {
    lines.push(`- ${row?.key ?? 'N/A'}: ${formatNumber(row?.realizedPnl)}`);
  }
  lines.push('');
  lines.push(isZh ? '### 主要贡献者（Top）' : '### Top contributors');
  for (const row of attribution?.contributors ?? []) {
    lines.push(
      (() => {
        const sym = String(row?.symbol || '').toUpperCase();
        const local = localPnlBySymbol.get(sym);
        const localText = local
          ? formatAmountWithCode(local.pnl, local.currency)
          : (isZh ? '无明细币种' : 'N/A local currency');
        const usdText = formatAmountWithCode(row?.realizedPnl, 'USD');
        return `- ${row?.symbol ?? 'N/A'} (${row?.category ?? 'N/A'}): local=${localText} | usdNormalized=${usdText}`;
      })()
    );
  }
  lines.push('');
  lines.push(isZh ? '### 主要拖累者（Top）' : '### Top detractors');
  for (const row of attribution?.detractors ?? []) {
    lines.push(
      (() => {
        const sym = String(row?.symbol || '').toUpperCase();
        const local = localPnlBySymbol.get(sym);
        const localText = local
          ? formatAmountWithCode(local.pnl, local.currency)
          : (isZh ? '无明细币种' : 'N/A local currency');
        const usdText = formatAmountWithCode(row?.realizedPnl, 'USD');
        return `- ${row?.symbol ?? 'N/A'} (${row?.category ?? 'N/A'}): local=${localText} | usdNormalized=${usdText}`;
      })()
    );
  }
  lines.push('');

  lines.push(isZh ? '## 月度已实现盈亏' : '## Monthly realized P/L');
  for (const row of monthly) {
    lines.push(`- ${row?.month ?? 'N/A'}: ${formatNumber(row?.realizedPnl)}`);
  }
  lines.push('');

  lines.push(isZh ? '## 交易收益分布直方图（桶 -> 笔数）' : '## Trade return histogram (bucket -> count)');
  for (const row of tradeHistogram) {
    lines.push(`- ${row?.bucket ?? 'N/A'}: ${formatNumber(row?.count, { maxFrac: 0 })}`);
  }
  lines.push('');

  lines.push(isZh ? '## 最佳交易（Top）' : '## Best trades');
  for (const tr of bestTrades) {
    lines.push(
      `- ${tr?.txDate ?? 'N/A'} | ${tr?.symbol ?? 'N/A'} | qty=${formatNumber(tr?.qty, { maxFrac: 8 })} | proceeds=${formatAmountWithCode(tr?.proceeds, tr?.currency)} | cost=${formatAmountWithCode(tr?.cost, tr?.currency)} | pnl=${formatAmountWithCode(tr?.pnl, tr?.currency)} | return=${formatPct(tr?.returnPct)} | pnlUsd=${formatAmountWithCode(tr?.pnlUsd, 'USD')}`
    );
  }
  lines.push('');

  lines.push(isZh ? '## 最差交易（Top）' : '## Worst trades');
  for (const tr of worstTrades) {
    lines.push(
      `- ${tr?.txDate ?? 'N/A'} | ${tr?.symbol ?? 'N/A'} | qty=${formatNumber(tr?.qty, { maxFrac: 8 })} | proceeds=${formatAmountWithCode(tr?.proceeds, tr?.currency)} | cost=${formatAmountWithCode(tr?.cost, tr?.currency)} | pnl=${formatAmountWithCode(tr?.pnl, tr?.currency)} | return=${formatPct(tr?.returnPct)} | pnlUsd=${formatAmountWithCode(tr?.pnlUsd, 'USD')}`
    );
  }
  lines.push('');

  if ((insights || []).length > 0) {
    lines.push(isZh ? '## 系统已有洞察' : '## Existing system insights');
    for (const insight of insights) {
      lines.push(`- ${insight}`);
    }
    lines.push('');
  }

  lines.push(isZh ? '## 你需要输出的内容' : '## Required output');
  lines.push(
    isZh
      ? '- 先给出 5-8 条结论（按重要性排序）。'
      : '- Start with 5-8 key conclusions, prioritized by importance.'
  );
  lines.push(
    isZh
      ? '- 从“策略、风险、执行、仓位/归因”四个维度做结构化点评。'
      : '- Provide structured review across strategy, risk, execution, and position/attribution.'
  );
  lines.push(
    isZh
      ? '- 明确指出最需要修复的 3 个问题，并给出可执行措施与量化目标。'
      : '- Identify the top 3 issues to fix, with actionable steps and measurable targets.'
  );
  lines.push(
    isZh
      ? '- 给出接下来 30 天的交易改进计划与监控指标。'
      : '- Provide a 30-day improvement plan and monitoring checklist.'
  );

  return lines.join('\n');
}
