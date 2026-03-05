import { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import DASHBOARD_CONFIG from './dashboardConfig';
import PORTFOLIO_CONFIG from './portfolioConfig';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
const ASSET_COLORS = ['#2dd4bf', '#38bdf8', '#4ade80', '#22d3ee', '#34d399'];
const LIABILITY_COLORS = ['#fb7185', '#f97316', '#f43f5e', '#ef4444', '#fda4af'];
const HOLDING_COLORS = ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#f472b6', '#60a5fa', '#f87171', '#facc15'];
const CASHFLOW_RANGE = "'Cashflow'!A1:C400";

function formatMaybeHidden(hideValues, formatter, value, hiddenText = 'Hidden') {
  if (hideValues) {
    return hiddenText;
  }
  return formatter(value);
}

function parseMoney(value) {
  if (typeof value !== 'string') {
    return 0;
  }

  const normalized = value.replace(/,/g, '').replace(/[^\d.-]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRmb(value) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatQty(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 8,
  }).format(value);
}

function formatPercent(value) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatPercentUnsigned(value) {
  return `${value.toFixed(2)}%`;
}

function buildDynamicDomain(data, key) {
  if (!Array.isArray(data) || data.length === 0) {
    return ['auto', 'auto'];
  }

  const values = data.map((item) => Number(item[key]) || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.02, 1);
    return [min - padding, max + padding];
  }

  const span = max - min;
  const padding = span * 0.08;
  return [min - padding, max + padding];
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function getCellValue(headers, rows, cellRef) {
  const match = /^([A-Z]+)(\d+)$/i.exec(String(cellRef || '').trim());
  if (!match) {
    return '';
  }

  const [, letters, rowDigits] = match;
  const rowNumber = Number.parseInt(rowDigits, 10);
  const columnIndex = letters
    .toUpperCase()
    .split('')
    .reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0) - 1;

  if (rowNumber === 1) {
    return headers[columnIndex] || '';
  }

  return rows[rowNumber - 2]?.[columnIndex] || '';
}

function findComponentValue(headers, rows, component, config) {
  if (component.cellRef) {
    const rawCellValue = getCellValue(headers, rows, component.cellRef);
    const valueFromCell = parseMoney(rawCellValue);
    return {
      found: String(rawCellValue || '').trim() !== '',
      value: valueFromCell,
    };
  }

  const labelColumnIndex = Number.isInteger(component.labelColumnIndex)
    ? component.labelColumnIndex
    : config.labelColumnIndex;
  const valueColumnIndex = Number.isInteger(component.valueColumnIndex)
    ? component.valueColumnIndex
    : config.valueColumnIndex;
  const target = normalizeText(component.labelMatch);

  const matchedRow = rows.find((row) => {
    const label = normalizeText(row[labelColumnIndex]);
    if (!label || !target) {
      return false;
    }

    if (component.matchMode === 'exact') {
      return label === target;
    }

    return label.includes(target);
  });

  if (!matchedRow) {
    return { found: false, value: 0 };
  }

  return {
    found: true,
    value: parseMoney(matchedRow[valueColumnIndex]),
  };
}

function useSheetData(range) {
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function loadSheetData() {
      try {
        setIsLoading(true);
        setError('');

        const params = new URLSearchParams();
        if (range) {
          params.set('range', range);
        }

        const query = params.toString();
        const response = await fetch(`${API_BASE_URL}/api/sheet${query ? `?${query}` : ''}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('Backend returned an error response.');
        }

        const data = await response.json();
        setHeaders(data.headers || []);
        setRows(data.rows || []);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError('Could not load sheet data. Verify backend and Google Sheet settings.');
        }
      } finally {
        setIsLoading(false);
      }
    }

    loadSheetData();

    return () => controller.abort();
  }, [range]);

  return { headers, rows, isLoading, error };
}

function OverviewPage({ hideValues }) {
  const { headers, rows, isLoading, error } = useSheetData();

  const componentValues = useMemo(
    () =>
      DASHBOARD_CONFIG.totalComponents.map((component) => {
        const result = findComponentValue(headers, rows, component, DASHBOARD_CONFIG);
        return {
          key: component.key,
          name: component.displayName || component.labelMatch,
          ...result,
        };
      }),
    [headers, rows],
  );

  const missingComponents = useMemo(
    () => componentValues.filter((item) => !item.found).map((item) => item.name),
    [componentValues],
  );

  const chartComponents = useMemo(
    () => componentValues.filter((item) => item.found && item.value !== 0),
    [componentValues],
  );

  const totalNetWorth = useMemo(
    () => componentValues.reduce((sum, component) => sum + component.value, 0),
    [componentValues],
  );

  return (
    <section className="contentWrap">
      <header className="pageHeader">
        <h1>Net Worth Overview</h1>
      </header>

      <div className="dashboardPanel">
        {isLoading && <p>Loading sheet data...</p>}
        {!isLoading && error && <p className="error">{error}</p>}
        {!isLoading && !error && headers.length === 0 && <p>No rows found in the configured range.</p>}

        {!isLoading && !error && headers.length > 0 && (
          <>
            <div className="kpiCard">
              <p className="kpiLabel">Total Net Worth</p>
              <p className={`kpiValue ${totalNetWorth >= 0 ? 'pos' : 'neg'}`}>
                {formatMaybeHidden(hideValues, formatRmb, totalNetWorth)}
              </p>
              <ul className="kpiBreakdown">
                {componentValues.map((component) => (
                  <li key={component.key}>
                    <span>{component.name}</span>
                    <strong className={component.value >= 0 ? 'pos' : 'neg'}>
                      {component.found ? formatMaybeHidden(hideValues, formatRmb, component.value) : 'Not found'}
                    </strong>
                  </li>
                ))}
              </ul>
              {missingComponents.length > 0 && (
                <p className="kpiSource">Missing rows: {missingComponents.join(', ')}</p>
              )}
            </div>

            <article className="chartCard">
              <h2>Asset vs Liability Breakdown</h2>
              <div className="chartArea">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartComponents} layout="vertical" margin={{ top: 8, right: 18, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      type="number"
                      tickFormatter={(value) => formatMaybeHidden(hideValues, formatRmb, Number(value) || 0, '')}
                      tick={{ fill: '#94a3b8', fontSize: 12 }}
                    />
                    <YAxis type="category" dataKey="name" width={180} tick={{ fill: '#cbd5e1', fontSize: 12 }} />
                    <Tooltip
                      formatter={(value) => formatMaybeHidden(hideValues, formatRmb, Number(value) || 0)}
                      contentStyle={{
                        backgroundColor: '#0b1220',
                        border: '1px solid #334155',
                        borderRadius: '10px',
                        color: '#e2e8f0',
                      }}
                      labelStyle={{ color: '#f8fafc' }}
                      itemStyle={{ color: '#e2e8f0' }}
                    />
                    <ReferenceLine x={0} stroke="#64748b" />
                    <Bar dataKey="value" radius={[4, 4, 4, 4]}>
                      {chartComponents.map((entry, index) => (
                        <Cell
                          key={`${entry.key}-bar-${index}`}
                          fill={entry.value >= 0 ? ASSET_COLORS[index % ASSET_COLORS.length] : LIABILITY_COLORS[index % LIABILITY_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>
          </>
        )}
      </div>
    </section>
  );
}

function PerformancePage({ hideValues }) {
  const { rows, isLoading, error } = useSheetData(CASHFLOW_RANGE);

  const cashflowData = useMemo(
    () =>
      rows
        .map((row) => {
          const date = String(row[0] || '').trim();
          const netWorth = parseMoney(row[1]);
          return { date, netWorth };
        })
        .filter((item) => item.date !== '' && item.netWorth !== 0),
    [rows],
  );

  const derivedSeries = useMemo(
    () =>
      cashflowData.map((item, index) => {
        if (index === 0) {
          return { ...item, derivedChangePct: 0 };
        }
        const prev = cashflowData[index - 1];
        const derivedChangePct = prev.netWorth === 0 ? 0 : ((item.netWorth - prev.netWorth) / prev.netWorth) * 100;
        return { ...item, derivedChangePct };
      }),
    [cashflowData],
  );

  const summary = useMemo(() => {
    if (cashflowData.length === 0) {
      return {
        latest: { date: '-', netWorth: 0 },
        peak: { date: '-', netWorth: 0 },
        bottom: { date: '-', netWorth: 0 },
        latestPeriodChangePct: 0,
        latestPeriodSubtitle: '-',
      };
    }

    const latest = cashflowData[cashflowData.length - 1];
    const peak = cashflowData.reduce((acc, item) => (item.netWorth > acc.netWorth ? item : acc), cashflowData[0]);
    const bottom = cashflowData.reduce((acc, item) => (item.netWorth < acc.netWorth ? item : acc), cashflowData[0]);
    const prev = cashflowData.length > 1 ? cashflowData[cashflowData.length - 2] : null;
    const latestPeriodChangePct = prev ? ((latest.netWorth - prev.netWorth) / prev.netWorth) * 100 : 0;

    return {
      latest,
      peak,
      bottom,
      latestPeriodChangePct,
      latestPeriodSubtitle: prev ? `${prev.date} -> ${latest.date}` : latest.date,
    };
  }, [cashflowData]);

  const netWorthDomain = useMemo(
    () => buildDynamicDomain(cashflowData, 'netWorth'),
    [cashflowData],
  );

  return (
    <section className="contentWrap">
      <header className="pageHeader">
        <h1>Net Worth Performance</h1>
      </header>

      <div className="dashboardPanel">
        {isLoading && <p>Loading sheet data...</p>}
        {!isLoading && error && <p className="error">{error}</p>}
        {!isLoading && !error && cashflowData.length === 0 && <p>No cashflow rows found in `Cashflow`.</p>}

        {!isLoading && !error && cashflowData.length > 0 && (
          <>
            <div className="kpiRow">
              <article className="miniKpi">
                <p>Latest Net Worth Snapshot</p>
                <h3>{formatMaybeHidden(hideValues, formatRmb, summary.latest.netWorth)}</h3>
                <small>{summary.latest.date}</small>
              </article>
              <article className="miniKpi">
                <p>Period-over-Period Return</p>
                <h3 className={summary.latestPeriodChangePct >= 0 ? 'pos' : 'neg'}>
                  {formatPercent(summary.latestPeriodChangePct)}
                </h3>
                <small>{summary.latestPeriodSubtitle}</small>
              </article>
              <article className="miniKpi">
                <p>All-Time High Net Worth</p>
                <h3 className="pos">{formatMaybeHidden(hideValues, formatRmb, summary.peak.netWorth)}</h3>
                <small>{summary.peak.date}</small>
              </article>
              <article className="miniKpi">
                <p>All-Time Low Net Worth</p>
                <h3 className="neg">{formatMaybeHidden(hideValues, formatRmb, summary.bottom.netWorth)}</h3>
                <small>{summary.bottom.date}</small>
              </article>
            </div>

            <div className="portfolioCharts">
              <article className="chartCard">
                <h2>Net Worth Time Series</h2>
                <div className="chartArea compact">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={cashflowData} margin={{ top: 8, right: 18, left: 24, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                      <YAxis
                        domain={netWorthDomain}
                        tickFormatter={(value) => formatMaybeHidden(hideValues, formatRmb, Number(value) || 0, '')}
                        tick={{ fill: '#94a3b8', fontSize: 12 }}
                        width={120}
                        tickMargin={6}
                      />
                      <Tooltip
                        formatter={(value) => formatMaybeHidden(hideValues, formatRmb, Number(value) || 0)}
                        contentStyle={{
                          backgroundColor: '#0b1220',
                          border: '1px solid #334155',
                          borderRadius: '10px',
                          color: '#e2e8f0',
                        }}
                        labelStyle={{ color: '#f8fafc' }}
                        itemStyle={{ color: '#e2e8f0' }}
                      />
                      <Line type="monotone" dataKey="netWorth" stroke="#22d3ee" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="chartCard">
                <h2>Period Return (%)</h2>
                <div className="chartArea compact">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={derivedSeries} margin={{ top: 8, right: 18, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                      <YAxis tickFormatter={(value) => `${value}%`} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                      <Tooltip
                        formatter={(value) => formatPercent(Number(value) || 0)}
                        contentStyle={{
                          backgroundColor: '#0b1220',
                          border: '1px solid #334155',
                          borderRadius: '10px',
                          color: '#e2e8f0',
                        }}
                        labelStyle={{ color: '#f8fafc' }}
                        itemStyle={{ color: '#e2e8f0' }}
                      />
                      <ReferenceLine y={0} stroke="#64748b" />
                      <Bar dataKey="derivedChangePct" radius={[4, 4, 0, 0]}>
                        {derivedSeries.map((entry, index) => (
                          <Cell key={`${entry.date}-${index}`} fill={entry.derivedChangePct >= 0 ? '#22c55e' : '#fb7185'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function PortfolioPage({ hideValues }) {
  const { headers, rows, isLoading, error } = useSheetData(PORTFOLIO_CONFIG.range);

  const positions = useMemo(
    () =>
      PORTFOLIO_CONFIG.assets.map((asset) => {
        const qtyRaw = getCellValue(headers, rows, asset.qtyCell);
        const purchasePriceRaw = getCellValue(headers, rows, asset.purchasePriceCell);
        const currentPriceRaw = getCellValue(headers, rows, asset.currentPriceCell);
        const qty = parseMoney(qtyRaw);
        const purchasePrice = parseMoney(purchasePriceRaw);
        const currentPrice = parseMoney(currentPriceRaw);

        const totalPurchaseCost = qty * purchasePrice;
        const currentValue = qty * currentPrice;
        const pnl = currentValue - totalPurchaseCost;
        const pnlPct = totalPurchaseCost === 0 ? 0 : (pnl / totalPurchaseCost) * 100;

        const found = [qtyRaw, purchasePriceRaw, currentPriceRaw].some((value) => String(value || '').trim() !== '');

        return {
          ...asset,
          found,
          qty,
          purchasePrice,
          currentPrice,
          totalPurchaseCost,
          currentValue,
          pnl,
          pnlPct,
        };
      }),
    [headers, rows],
  );

  const visiblePositions = useMemo(() => positions.filter((position) => position.found), [positions]);

  const totals = useMemo(() => {
    return visiblePositions.reduce(
      (acc, position) => {
        acc.cost += position.totalPurchaseCost;
        acc.value += position.currentValue;
        acc.pnl += position.pnl;
        return acc;
      },
      { cost: 0, value: 0, pnl: 0 },
    );
  }, [visiblePositions]);

  const totalPnlPct = totals.cost === 0 ? 0 : (totals.pnl / totals.cost) * 100;

  const chartData = useMemo(
    () => visiblePositions.map((p) => ({ name: p.name, pnl: p.pnl })),
    [visiblePositions],
  );

  const assetColorMap = useMemo(() => {
    const map = new Map();
    visiblePositions.forEach((position, index) => {
      map.set(position.name, HOLDING_COLORS[index % HOLDING_COLORS.length]);
    });
    return map;
  }, [visiblePositions]);

  const allocationData = useMemo(
    () =>
      visiblePositions
        .filter((position) => position.currentValue > 0)
        .map((position) => ({ name: position.name, value: position.currentValue })),
    [visiblePositions],
  );

  const rowsWithWeight = useMemo(
    () =>
      visiblePositions.map((position) => ({
        ...position,
        weightPct: totals.value === 0 ? 0 : (position.currentValue / totals.value) * 100,
      })),
    [visiblePositions, totals.value],
  );

  return (
    <section className="contentWrap">
      <header className="pageHeader">
        <h1>Portfolio Holdings</h1>
      </header>

      <div className="dashboardPanel">
        {isLoading && <p>Loading sheet data...</p>}
        {!isLoading && error && <p className="error">{error}</p>}

        {!isLoading && !error && (
          <>
            <div className="kpiRow">
              <article className="miniKpi">
                <p>Total Cost Basis</p>
                <h3>{formatMaybeHidden(hideValues, formatMoney, totals.cost)}</h3>
              </article>
              <article className="miniKpi">
                <p>Total Market Value</p>
                <h3>{formatMaybeHidden(hideValues, formatMoney, totals.value)}</h3>
              </article>
              <article className="miniKpi">
                <p>Total Unrealized P/L</p>
                <h3 className={totals.pnl >= 0 ? 'pos' : 'neg'}>{formatMaybeHidden(hideValues, formatMoney, totals.pnl)}</h3>
                <small className={totals.pnl >= 0 ? 'pos' : 'neg'}>{formatPercent(totalPnlPct)}</small>
              </article>
            </div>

            <div className="portfolioCharts">
              <article className="chartCard">
                <h2>Holdings Allocation (% of Market Value)</h2>
                <div className="chartArea compact">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={allocationData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={95}
                        paddingAngle={2}
                      >
                        {allocationData.map((entry, index) => (
                          <Cell
                            key={`${entry.name}-alloc-${index}`}
                            fill={assetColorMap.get(entry.name) || HOLDING_COLORS[index % HOLDING_COLORS.length]}
                            stroke="#0b1220"
                            strokeWidth={2}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => formatMaybeHidden(hideValues, formatMoney, Number(value) || 0)}
                        contentStyle={{
                          backgroundColor: '#0b1220',
                          border: '1px solid #334155',
                          borderRadius: '10px',
                          color: '#e2e8f0',
                        }}
                        labelStyle={{ color: '#f8fafc' }}
                        itemStyle={{ color: '#e2e8f0' }}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="chartCard">
                <h2>Unrealized P/L by Holding</h2>
                <div className="chartArea compact">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 18, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis
                        type="number"
                        tickFormatter={(value) => formatMaybeHidden(hideValues, formatMoney, Number(value) || 0, '')}
                        tick={{ fill: '#94a3b8', fontSize: 12 }}
                      />
                      <YAxis type="category" dataKey="name" width={100} tick={{ fill: '#cbd5e1', fontSize: 12 }} />
                      <Tooltip
                        formatter={(value) => formatMaybeHidden(hideValues, formatMoney, Number(value) || 0)}
                        contentStyle={{
                          backgroundColor: '#0b1220',
                          border: '1px solid #334155',
                          borderRadius: '10px',
                          color: '#e2e8f0',
                        }}
                        labelStyle={{ color: '#f8fafc' }}
                        itemStyle={{ color: '#e2e8f0' }}
                      />
                      <ReferenceLine x={0} stroke="#64748b" />
                      <Bar dataKey="pnl" radius={[4, 4, 4, 4]}>
                        {chartData.map((entry, index) => (
                          <Cell
                            key={`${entry.name}-pnl-${index}`}
                            fill={assetColorMap.get(entry.name) || HOLDING_COLORS[index % HOLDING_COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>
            </div>

            <article className="tableCard">
              <h2>Positions</h2>
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Asset Type</th>
                      <th>Quantity</th>
                      <th>Avg Cost per Unit</th>
                      <th>Cost Basis</th>
                      <th>Market Price</th>
                      <th>Market Value</th>
                      <th>Portfolio Weight (%)</th>
                      <th>Unrealized Gain/Loss</th>
                      <th>Unrealized Return (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsWithWeight.map((item) => (
                      <tr key={item.key}>
                        <td>{item.name}</td>
                        <td>{item.category}</td>
                        <td>{formatMaybeHidden(hideValues, formatQty, item.qty)}</td>
                        <td>{formatMaybeHidden(hideValues, formatMoney, item.purchasePrice)}</td>
                        <td>{formatMaybeHidden(hideValues, formatMoney, item.totalPurchaseCost)}</td>
                        <td>{formatMaybeHidden(hideValues, formatMoney, item.currentPrice)}</td>
                        <td>{formatMaybeHidden(hideValues, formatMoney, item.currentValue)}</td>
                        <td>{formatPercentUnsigned(item.weightPct)}</td>
                        <td className={item.pnl >= 0 ? 'pos' : 'neg'}>{formatMaybeHidden(hideValues, formatMoney, item.pnl)}</td>
                        <td className={item.pnl >= 0 ? 'pos' : 'neg'}>{formatPercent(item.pnlPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </>
        )}
      </div>
    </section>
  );
}

function App() {
  const [hideValues, setHideValues] = useState(() => {
    const saved = localStorage.getItem('hide_values_enabled');
    return saved === 'true';
  });

  useEffect(() => {
    localStorage.setItem('hide_values_enabled', String(hideValues));
  }, [hideValues]);

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
          <NavLink to="/overview" className={({ isActive }) => `navLink${isActive ? ' active' : ''}`}>
            Net Worth Overview
          </NavLink>
          <NavLink to="/performance" className={({ isActive }) => `navLink${isActive ? ' active' : ''}`}>
            Net Worth Performance
          </NavLink>
          <NavLink to="/portfolio" className={({ isActive }) => `navLink${isActive ? ' active' : ''}`}>
            Portfolio Holdings
          </NavLink>
        </nav>
      </aside>

      <main className="mainContent">
        <Routes>
          <Route path="/overview" element={<OverviewPage hideValues={hideValues} />} />
          <Route path="/performance" element={<PerformancePage hideValues={hideValues} />} />
          <Route path="/portfolio" element={<PortfolioPage hideValues={hideValues} />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
