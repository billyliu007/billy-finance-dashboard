import { useMemo, useState } from 'react';
import { HOLDING_COLORS } from '../constants.js';
import PortfolioCharts from '../components/portfolio/PortfolioCharts.jsx';
import PortfolioKpis from '../components/portfolio/PortfolioKpis.jsx';
import PortfolioPositionsTable from '../components/portfolio/PortfolioPositionsTable.jsx';
import AddCryptoPositionModal from '../components/portfolio/AddCryptoPositionModal.jsx';
import AddStockPositionModal from '../components/portfolio/AddStockPositionModal.jsx';
import EditCryptoPositionModal from '../components/portfolio/EditCryptoPositionModal.jsx';
import { useDashboard } from '../contexts/DashboardContext.jsx';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import { deleteJson } from '../utils/api.js';

export default function PortfolioPage({ hideValues }) {
  const { t } = useLanguage();
  const { portfolio: data, netWorth, isLoading, error, refresh, mutate } = useDashboard();
  const [isAddCryptoOpen, setIsAddCryptoOpen] = useState(false);
  const [isAddStockOpen, setIsAddStockOpen] = useState(false);
  const [editPosition, setEditPosition] = useState(null);
  const [holdingToDelete, setHoldingToDelete] = useState(null);
  const [isDeletingHolding, setIsDeletingHolding] = useState(false);
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
        <h1>{t('portfolio.title')}</h1>
      </header>

      <div className="dashboardPanel">
        {isLoading && <p>{t('app.loadingDashboard')}</p>}
        {!isLoading && error && <p className="error">{error}</p>}
        {!isLoading && !error && data?.isEmpty && <p>{t('portfolio.noPositionsFound')}</p>}

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
              cashComponents={netWorth?.overview?.cashComponents ?? []}
              onRefresh={refresh}
              onAddCrypto={() => setIsAddCryptoOpen(true)}
              onAddStock={() => setIsAddStockOpen(true)}
              onEditPosition={(position) => setEditPosition(position)}
              onDeletePosition={(position) => setHoldingToDelete(position)}
            />
          </>
        )}

        <AddCryptoPositionModal
          open={isAddCryptoOpen}
          onClose={() => setIsAddCryptoOpen(false)}
          onSaved={() => refresh?.({ mode: 'silent' })}
        />
        <AddStockPositionModal
          open={isAddStockOpen}
          onClose={() => setIsAddStockOpen(false)}
          onSaved={() => refresh?.({ mode: 'silent' })}
        />
        <EditCryptoPositionModal
          open={Boolean(editPosition)}
          position={editPosition ?? undefined}
          onClose={() => setEditPosition(null)}
          onSaved={() => {
            refresh?.({ mode: 'silent' });
            setEditPosition(null);
          }}
        />

        {holdingToDelete && (
          <div className="modalOverlay" role="presentation" onMouseDown={() => setHoldingToDelete(null)}>
            <div className="modalCard" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
              <div className="modalHeader">
                <h2>Delete holding?</h2>
                <button type="button" className="modalCloseBtn" onClick={() => setHoldingToDelete(null)}>
                  {t('modals.close')}
                </button>
              </div>
              <div className="modalBody">
                <p className="modalHint">{t('portfolio.removeConfirm', { name: holdingToDelete.name })}</p>
              </div>
              <div className="modalFooter">
                <button
                  type="button"
                  className="modalBtn secondary"
                  onClick={() => setHoldingToDelete(null)}
                  disabled={isDeletingHolding}
                >
                  {t('modals.cancel')}
                </button>
                <button
                  type="button"
                  className="modalBtn danger"
                  disabled={isDeletingHolding}
                  onClick={async () => {
                    const position = holdingToDelete;
                    setIsDeletingHolding(true);
                    setHoldingToDelete(null);
                    try {
                      mutate?.((prev) => {
                        if (!prev?.portfolio) return prev;
                        const currentRows = Array.isArray(prev.portfolio.tableRows) ? prev.portfolio.tableRows : [];
                        const nextRows = currentRows.filter((r) => String(r.symbol) !== String(position.symbol));
                        return {
                          ...prev,
                          portfolio: {
                            ...prev.portfolio,
                            tableRows: nextRows,
                          },
                        };
                      });
                      await deleteJson(`/api/portfolio/positions/${encodeURIComponent(position.symbol)}`);
                      refresh?.({ mode: 'silent' });
                    } catch (err) {
                      window.alert(err?.message || t('errors.failedDeletePosition'));
                      refresh?.({ mode: 'silent' });
                    } finally {
                      setIsDeletingHolding(false);
                    }
                  }}
                >
                  {isDeletingHolding ? t('modals.removing') : t('modals.remove')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
