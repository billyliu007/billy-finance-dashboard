import CashTableCard from '../components/networth/CashTableCard.jsx';
import NetWorthSummaryCard from '../components/networth/NetWorthSummaryCard.jsx';
import PerformanceCharts from '../components/networth/PerformanceCharts.jsx';
import PerformanceKpis from '../components/networth/PerformanceKpis.jsx';
import useApiData from '../hooks/useApiData.js';

function OverviewPanel({ hideValues, overview, isLoading, error }) {
  return (
    <section className="contentWrap">
      <header className="pageHeader">
        <h1>Net Worth</h1>
      </header>

      <div className="dashboardPanel">
        {isLoading && <p>Loading dashboard data...</p>}
        {!isLoading && error && <p className="error">{error}</p>}
        {!isLoading && !error && !overview?.hasData && <p>No cash/debt records found yet.</p>}

        {!isLoading && !error && overview?.hasData && (
          <>
            <NetWorthSummaryCard
              hideValues={hideValues}
              totalNetWorth={overview.totalNetWorth}
              netWorthBounds={overview.netWorthBounds}
              componentValues={overview.componentValues || []}
              missingInputs={overview.missingInputs || []}
            />
            <CashTableCard hideValues={hideValues} rows={overview.cashRows || []} />
          </>
        )}
      </div>
    </section>
  );
}

function PerformancePanel({ hideValues, performance, isLoading, error }) {
  return (
    <section className="contentWrap">
      <div className="dashboardPanel">
        {isLoading && <p>Loading dashboard data...</p>}
        {!isLoading && error && <p className="error">{error}</p>}
        {!isLoading && !error && !performance?.hasData && <p>No net worth history is available yet.</p>}

        {!isLoading && !error && performance?.hasData && (
          <>
            <PerformanceKpis hideValues={hideValues} summary={performance.summary} />
            <PerformanceCharts
              hideValues={hideValues}
              cashflowData={performance.cashflowData || []}
              derivedSeries={performance.derivedSeries || []}
              netWorthDomain={performance.netWorthDomain || ['auto', 'auto']}
            />
          </>
        )}
      </div>
    </section>
  );
}

export default function NetWorthPage({ hideValues }) {
  const { data, isLoading, error } = useApiData('/api/dashboard/net-worth', { refreshMs: 60_000 });

  return (
    <>
      <OverviewPanel hideValues={hideValues} overview={data?.overview} isLoading={isLoading} error={error} />
      <PerformancePanel hideValues={hideValues} performance={data?.performance} isLoading={isLoading} error={error} />
    </>
  );
}
