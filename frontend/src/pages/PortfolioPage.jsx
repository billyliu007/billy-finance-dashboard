import { useMemo, useState } from 'react';
import { HOLDING_COLORS } from '../constants.js';
import PortfolioCharts from '../components/portfolio/PortfolioCharts.jsx';
import PortfolioKpis from '../components/portfolio/PortfolioKpis.jsx';
import PortfolioPositionsTable from '../components/portfolio/PortfolioPositionsTable.jsx';
import AddCryptoPositionModal from '../components/portfolio/AddCryptoPositionModal.jsx';
import AddStockPositionModal from '../components/portfolio/AddStockPositionModal.jsx';
import EditCryptoPositionModal from '../components/portfolio/EditCryptoPositionModal.jsx';
import { useDashboard } from '../contexts/DashboardContext.jsx';
import { deleteJson } from '../utils/api.js';

export default function PortfolioPage({ hideValues }) {
  const { portfolio: data, isLoading, error, refresh } = useDashboard();
  const [isAddCryptoOpen, setIsAddCryptoOpen] = useState(false);
  const [isAddStockOpen, setIsAddStockOpen] = useState(false);
  const [editPosition, setEditPosition] = useState(null);
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
        {isLoading && <p>Loading dashboard data...</p>}
        {!isLoading && error && <p className="error">{error}</p>}
        {!isLoading && !error && data?.isEmpty && <p>No portfolio positions found yet.</p>}

        {!isLoading && !error && data && !data.isEmpty && (
          <>
            <PortfolioKpis hideValues={hideValues} totals={data.totals} totalPnlPct={data.totalPnlPct} />
            <PortfolioCharts
              hideValues={hideValues}
              allocationData={allocationData}
              chartData={chartData}
              assetColorMap={assetColorMap}
            />
            <PortfolioPositionsTable
              hideValues={hideValues}
              rows={rows}
              onAddCrypto={() => setIsAddCryptoOpen(true)}
              onAddStock={() => setIsAddStockOpen(true)}
              onEditPosition={(position) => setEditPosition(position)}
              onDeletePosition={async (position) => {
                if (!window.confirm(`Are you sure you want to remove ${position.name}? This cannot be undone.`)) return;
                try {
                  await deleteJson(`/api/portfolio/positions/${encodeURIComponent(position.symbol)}`);
                  refresh?.();
                } catch (err) {
                  window.alert(err?.message || 'Failed to delete position.');
                }
              }}
            />
          </>
        )}

        <AddCryptoPositionModal
          open={isAddCryptoOpen}
          onClose={() => setIsAddCryptoOpen(false)}
          onSaved={() => refresh?.()}
        />
        <AddStockPositionModal
          open={isAddStockOpen}
          onClose={() => setIsAddStockOpen(false)}
          onSaved={() => refresh?.()}
        />
        <EditCryptoPositionModal
          open={Boolean(editPosition)}
          position={editPosition ?? undefined}
          onClose={() => setEditPosition(null)}
          onSaved={() => {
            refresh?.();
            setEditPosition(null);
          }}
        />
      </div>
    </section>
  );
}
