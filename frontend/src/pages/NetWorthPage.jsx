import { useMemo } from 'react';
import CashTableCard from '../components/networth/CashTableCard';
import NetWorthSummaryCard from '../components/networth/NetWorthSummaryCard';
import PerformanceCharts from '../components/networth/PerformanceCharts';
import PerformanceKpis from '../components/networth/PerformanceKpis';
import { CASHFLOW_RANGE, NET_WORTH_COMPONENTS } from '../constants';
import useSheetData from '../hooks/useSheetData';
import DASHBOARD_CONFIG from '../dashboardConfig';
import PORTFOLIO_CONFIG from '../portfolioConfig';
import { buildDynamicDomain, parseMoney, percentFromReference } from '../utils/formatters';
import { findComponentValue } from '../utils/sheet';
import {
  aggregateComputedTotals,
  buildDetailRows,
  buildFxRates,
  computeUsdPositionsTotal,
} from '../utils/netWorth';

function OverviewPanel({ hideValues }) {
  const { headers, rows, isLoading, error } = useSheetData();
  const { rows: cashflowRows } = useSheetData(CASHFLOW_RANGE);
  const forexRange = DASHBOARD_CONFIG.forexRange || "'Forex'!A1:C20";
  const { headers: forexHeaders, rows: forexRows } = useSheetData(forexRange);
  const { headers: portfolioHeaders, rows: portfolioRows } = useSheetData(PORTFOLIO_CONFIG.range);

  const fxRates = useMemo(() => {
    return buildFxRates(forexHeaders, forexRows, DASHBOARD_CONFIG.forexRates);
  }, [forexHeaders, forexRows]);

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

  const usdPositionsTotal = useMemo(
    () => computeUsdPositionsTotal(PORTFOLIO_CONFIG.assets, portfolioHeaders, portfolioRows),
    [portfolioHeaders, portfolioRows],
  );

  const aggregatedTotalsByKey = useMemo(() => {
    return aggregateComputedTotals(visibleDetailRows, usdPositionsTotal, fxRates);
  }, [visibleDetailRows, usdPositionsTotal, fxRates]);

  const componentValues = useMemo(
    () =>
      NET_WORTH_COMPONENTS.map((component) => ({
        key: component.key,
        name: component.displayName,
        ...(aggregatedTotalsByKey[component.key] || { found: false, value: 0 }),
      })),
    [aggregatedTotalsByKey],
  );

  const missingComponents = useMemo(
    () => componentValues.filter((item) => !item.found).map((item) => item.name),
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
              missingComponents={missingComponents}
            />

            <CashTableCard hideValues={hideValues} rows={visibleDetailRows} />
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
