import { useState } from 'react';
import CashTableCard from '../components/networth/CashTableCard.jsx';
import NetWorthSummaryCard from '../components/networth/NetWorthSummaryCard.jsx';
import AddCashModal from '../components/networth/AddCashModal.jsx';
import EditCashModal from '../components/networth/EditCashModal.jsx';
import DeleteCashConfirmModal from '../components/networth/DeleteCashConfirmModal.jsx';
import PerformanceCharts from '../components/networth/PerformanceCharts.jsx';
import PerformanceKpis from '../components/networth/PerformanceKpis.jsx';
import { useDashboard } from '../contexts/DashboardContext.jsx';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import { putJson } from '../utils/api.js';

function OverviewPanel({ hideValues, overview, isLoading, error, refresh }) {
  const { t } = useLanguage();
  const [isAddCashOpen, setIsAddCashOpen] = useState(false);
  const [editCash, setEditCash] = useState(null);
  const [cashToDelete, setCashToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const cashComponents = overview?.cashComponents ?? [];
  const cashRows = overview?.cashRows ?? [];

  function getCashByRow(row) {
    const id = row?.id ?? row?.key?.replace(/^cash_/, '');
    return cashComponents.find((c) => String(c.id) === String(id));
  }

  function handleDeleteClick(row) {
    const item = getCashByRow(row);
    if (!item) return;
    setCashToDelete(item);
  }

  async function handleConfirmDelete() {
    if (!cashToDelete) return;
    try {
      setIsDeleting(true);
      const nextList = cashComponents
        .filter((c) => c.id !== cashToDelete.id)
        .map((c) => ({ name: c.name, currency: c.currency, balance: c.balance }));
      await putJson('/api/cash', { cashComponents: nextList });
      setCashToDelete(null);
      refresh?.();
    } catch (err) {
      window.alert(err?.message || t('errors.failedDelete'));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section className="contentWrap">
      <header className="pageHeader">
        <h1>{t('netWorth.title')}</h1>
      </header>

      <div className="dashboardPanel">
        {isLoading && <p>{t('app.loadingDashboard')}</p>}
        {!isLoading && error && <p className="error">{error}</p>}
        {!isLoading && !error && !overview?.hasData && cashComponents.length === 0 && (
          <p className="hint">{t('netWorth.noRecords')}</p>
        )}

        {!isLoading && !error && (
          <>
            <NetWorthSummaryCard
              hideValues={hideValues}
              totalNetWorth={overview?.totalNetWorth ?? 0}
              netWorthBounds={overview?.netWorthBounds}
              componentValues={overview?.componentValues || []}
              missingInputs={overview?.missingInputs || []}
              baseCurrency={overview?.baseCurrency ?? 'USD'}
              onBaseCurrencyChange={refresh}
            />
            <CashTableCard
              hideValues={hideValues}
              rows={cashRows}
              baseCurrency={overview?.baseCurrency ?? 'USD'}
              onAdd={() => setIsAddCashOpen(true)}
              onEdit={(row) => setEditCash(getCashByRow(row) ?? null)}
              onDelete={handleDeleteClick}
            />
          </>
        )}

        <AddCashModal
          open={isAddCashOpen}
          onClose={() => setIsAddCashOpen(false)}
          onSaved={() => { refresh?.(); setIsAddCashOpen(false); }}
          existingComponents={cashComponents}
        />
        <EditCashModal
          open={Boolean(editCash)}
          cash={editCash ?? undefined}
          onClose={() => setEditCash(null)}
          onSaved={() => { refresh?.(); setEditCash(null); }}
          existingComponents={cashComponents}
        />
        <DeleteCashConfirmModal
          open={Boolean(cashToDelete)}
          cash={cashToDelete ?? undefined}
          onClose={() => setCashToDelete(null)}
          onConfirm={handleConfirmDelete}
          isDeleting={isDeleting}
        />
      </div>
    </section>
  );
}

function PerformancePanel({ hideValues, performance, isLoading, error, baseCurrency = 'USD' }) {
  const { t } = useLanguage();
  return (
    <section className="contentWrap">
      <div className="dashboardPanel">
        {isLoading && <p>{t('app.loadingDashboard')}</p>}
        {!isLoading && error && <p className="error">{error}</p>}
        {!isLoading && !error && !performance?.hasData && <p>{t('netWorth.noHistory')}</p>}

        {!isLoading && !error && performance?.hasData && (
          <>
            <PerformanceKpis hideValues={hideValues} summary={performance.summary} baseCurrency={baseCurrency} />
            <PerformanceCharts
              hideValues={hideValues}
              cashflowData={performance.cashflowData || []}
              derivedSeries={performance.derivedSeries || []}
              netWorthDomain={performance.netWorthDomain || ['auto', 'auto']}
              baseCurrency={baseCurrency}
            />
          </>
        )}
      </div>
    </section>
  );
}

export default function NetWorthPage({ hideValues }) {
  const { netWorth, isLoading, error, refresh } = useDashboard();
  const overview = netWorth?.overview;
  const performance = netWorth?.performance;

  return (
    <>
      <OverviewPanel hideValues={hideValues} overview={overview} isLoading={isLoading} error={error} refresh={refresh} />
      <PerformancePanel hideValues={hideValues} performance={performance} isLoading={isLoading} error={error} baseCurrency={overview?.baseCurrency ?? 'USD'} />
    </>
  );
}
