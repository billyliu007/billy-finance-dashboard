import { useMemo } from 'react';
import { HOLDING_COLORS } from '../constants.js';
import PortfolioCharts from '../components/portfolio/PortfolioCharts.jsx';
import PortfolioKpis from '../components/portfolio/PortfolioKpis.jsx';
import PortfolioPositionsTable from '../components/portfolio/PortfolioPositionsTable.jsx';
import useApiData from '../hooks/useApiData.js';

export default function PortfolioPage({ hideValues }) {
  const { data, isLoading, error } = useApiData('/api/dashboard/portfolio');
  const rows = useMemo(() => data?.tableRows || [], [data]);
  const allocationData = useMemo(() => data?.allocationData || [], [data]);
  const chartData = useMemo(() => data?.chartData || [], [data]);

  const assetColorMap = useMemo(() => {
    const map = new Map();
    rows.forEach((position, index) => {
      map.set(position.name, HOLDING_COLORS[index % HOLDING_COLORS.length]);
    });
    return map;
  }, [rows]);

  return (
    <section className="contentWrap">
      <header className="pageHeader">
        <h1>Portfolio Holdings</h1>
      </header>

      <div className="dashboardPanel">
        {isLoading && <p>Loading sheet data...</p>}
        {!isLoading && error && <p className="error">{error}</p>}
        {!isLoading && !error && data?.isEmpty && <p>No portfolio rows found in the configured range.</p>}

        {!isLoading && !error && data && !data.isEmpty && (
          <>
            <PortfolioKpis hideValues={hideValues} totals={data.totals} totalPnlPct={data.totalPnlPct} />
            <PortfolioCharts
              hideValues={hideValues}
              allocationData={allocationData}
              chartData={chartData}
              assetColorMap={assetColorMap}
            />
            <PortfolioPositionsTable hideValues={hideValues} rows={rows} />
          </>
        )}
      </div>
    </section>
  );
}
