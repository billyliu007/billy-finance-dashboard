import { useMemo } from 'react';
import CashTableCard from '../components/networth/CashTableCard';
import NetWorthSummaryCard from '../components/networth/NetWorthSummaryCard';
import PerformanceCharts from '../components/networth/PerformanceCharts';
import PerformanceKpis from '../components/networth/PerformanceKpis';
import { CASHFLOW_RANGE, NET_WORTH_COMPONENTS } from '../constants';
import useSheetData from '../hooks/useSheetData';
import useSheetsData from '../hooks/useSheetsData';
import DASHBOARD_CONFIG from '../dashboardConfig';
import PORTFOLIO_CONFIG from '../portfolioConfig';
import {
  buildDynamicDomain,
  parseMoney,
  percentFromReference,
} from '../utils/formatters';
import { findComponentValue } from '../utils/sheet';
import {
  aggregateComputedTotals,
  buildDetailRows,
  buildFxRates,
  computeUsdPositionsTotal,
} from '../utils/netWorth';

const EMPTY_ROWS = [];

function OverviewPanel({ hideValues }) {
  const netWorthRange = DASHBOARD_CONFIG.netWorthRange || "'Net Worth'!A1:Z1000";
  const forexRange = DASHBOARD_CONFIG.forexRange || "'Forex'!A1:C20";

  const { sheets, isLoading, error } = useSheetsData([
    netWorthRange,
    forexRange,
    PORTFOLIO_CONFIG.range,
  ]);
  const { rows: cashflowRows } = useSheetData(CASHFLOW_RANGE);

  const netWorthSheet = sheets[0] || { headers: [], rows: [] };
  const forexSheet = sheets[1] || { headers: [], rows: [] };
  const portfolioSheet = sheets[2] || { headers: [], rows: [] };

  const headers = netWorthSheet.headers || EMPTY_ROWS;
  const rows = netWorthSheet.rows || EMPTY_ROWS;
  const forexHeaders = forexSheet.headers || EMPTY_ROWS;
  const forexRows = forexSheet.rows || EMPTY_ROWS;
  const portfolioHeaders = portfolioSheet.headers || EMPTY_ROWS;
  const portfolioRows = portfolioSheet.rows || EMPTY_ROWS;

  const fxRates = useMemo(
    () => buildFxRates(forexHeaders, forexRows, DASHBOARD_CONFIG.forexRates),
    [forexHeaders, forexRows],
  );

  const detailRows = useMemo(
    () =>
      buildDetailRows(
        headers,
        rows,
        DASHBOARD_CONFIG.detailItems,
        findComponentValue,
        DASHBOARD_CONFIG,
        fxRates,
      ),
    [headers, rows, fxRates],
  );

  const visibleDetailRows = useMemo(() => detailRows.filter((item) => item.found), [detailRows]);
  const holdingsRows = useMemo(
    () =>
      visibleDetailRows.map((item) => ({
        key: `cash_${item.key}`,
        className: item.category,
        instrument: item.name,
        currency: item.currency,
        amountLocal: item.value,
        fxRate: item.fxRate,
        amountCny: item.cnyValue,
        amountClass: item.value >= 0 ? 'pos' : 'neg',
        amountCnyClass: item.cnyValue == null ? '' : item.cnyValue >= 0 ? 'pos' : 'neg',
      })),
    [visibleDetailRows],
  );

  const usdPositionsTotal = useMemo(
    () => computeUsdPositionsTotal(PORTFOLIO_CONFIG.assets, portfolioHeaders, portfolioRows),
    [portfolioHeaders, portfolioRows],
  );

  const aggregatedTotalsByKey = useMemo(
    () => aggregateComputedTotals(visibleDetailRows, usdPositionsTotal, fxRates),
    [visibleDetailRows, usdPositionsTotal, fxRates],
  );

  const componentValues = useMemo(
    () =>
      NET_WORTH_COMPONENTS.map((component) => ({
        key: component.key,
        name: component.displayName,
        ...(aggregatedTotalsByKey[component.key] || { found: false, value: 0, reason: 'Missing data' }),
      })),
    [aggregatedTotalsByKey],
  );

  const missingInputs = useMemo(
    () =>
      componentValues
        .filter((item) => !item.found)
        .map((item) => `${item.name}: ${item.reason || 'Missing data'}`),
    [componentValues],
  );

  const totalNetWorth = useMemo(
    () => componentValues.reduce((sum, component) => sum + component.value, 0),
    [componentValues],
  );

  const cashflowData = useMemo(
    () =>
      cashflowRows
        .map((row) => ({
          date: String(row[0] || '').trim(),
          netWorth: parseMoney(row[1]),
        }))
        .filter((item) => item.date !== '' && item.netWorth !== 0),
    [cashflowRows],
  );

  const netWorthBounds = useMemo(() => {
    if (cashflowData.length === 0) {
      return null;
    }

    const ath = cashflowData.reduce((acc, item) => (item.netWorth > acc.netWorth ? item : acc), cashflowData[0]);
    const atl = cashflowData.reduce((acc, item) => (item.netWorth < acc.netWorth ? item : acc), cashflowData[0]);

    return {
      pctToAth: percentFromReference(totalNetWorth, ath.netWorth),
      pctToAtl: percentFromReference(totalNetWorth, atl.netWorth),
    };
  }, [cashflowData, totalNetWorth]);

  return (
    <section className="contentWrap">
      <header className="pageHeader">
        <h1>Net Worth</h1>
      </header>

      <div className="dashboardPanel">
        {isLoading && <p>Loading sheet data...</p>}
        {!isLoading && error && <p className="error">{error}</p>}
        {!isLoading && !error && headers.length === 0 && <p>No rows found in the configured range.</p>}

        {!isLoading && !error && headers.length > 0 && (
          <>
            <NetWorthSummaryCard
              hideValues={hideValues}
              totalNetWorth={totalNetWorth}
              netWorthBounds={netWorthBounds}
              componentValues={componentValues}
              missingInputs={missingInputs}
            />

            <CashTableCard hideValues={hideValues} rows={holdingsRows} />
          </>
        )}
      </div>
    </section>
  );
}

function PerformancePanel({ hideValues }) {
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

  const netWorthDomain = useMemo(() => buildDynamicDomain(cashflowData, 'netWorth'), [cashflowData]);

  return (
    <section className="contentWrap">
      <div className="dashboardPanel">
        {isLoading && <p>Loading sheet data...</p>}
        {!isLoading && error && <p className="error">{error}</p>}
        {!isLoading && !error && cashflowData.length === 0 && <p>No cashflow rows found in `Cashflow`.</p>}

        {!isLoading && !error && cashflowData.length > 0 && (
          <>
            <PerformanceKpis hideValues={hideValues} summary={summary} />
            <PerformanceCharts
              hideValues={hideValues}
              cashflowData={cashflowData}
              derivedSeries={derivedSeries}
              netWorthDomain={netWorthDomain}
            />
          </>
        )}
      </div>
    </section>
  );
}

export default function NetWorthPage({ hideValues }) {
  return (
    <>
      <OverviewPanel hideValues={hideValues} />
      <PerformancePanel hideValues={hideValues} />
    </>
  );
}
