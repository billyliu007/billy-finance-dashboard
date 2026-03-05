import { useMemo } from 'react';
import { HOLDING_COLORS } from '../constants';
import PortfolioCharts from '../components/portfolio/PortfolioCharts';
import PortfolioKpis from '../components/portfolio/PortfolioKpis';
import PortfolioPositionsTable from '../components/portfolio/PortfolioPositionsTable';
import useSheetData from '../hooks/useSheetData';
import PORTFOLIO_CONFIG from '../portfolioConfig';
import {
  parseMoney,
} from '../utils/formatters';
import { getCellValue } from '../utils/sheet';

export default function PortfolioPage({ hideValues }) {
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

  const totals = useMemo(
    () =>
      visiblePositions.reduce(
        (acc, position) => {
          acc.cost += position.totalPurchaseCost;
          acc.value += position.currentValue;
          acc.pnl += position.pnl;
          return acc;
        },
        { cost: 0, value: 0, pnl: 0 },
      ),
    [visiblePositions],
  );

  const totalPnlPct = totals.cost === 0 ? 0 : (totals.pnl / totals.cost) * 100;

  const chartData = useMemo(() => visiblePositions.map((p) => ({ name: p.name, pnl: p.pnl })), [visiblePositions]);

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
            <PortfolioKpis hideValues={hideValues} totals={totals} totalPnlPct={totalPnlPct} />
            <PortfolioCharts
              hideValues={hideValues}
              allocationData={allocationData}
              chartData={chartData}
              assetColorMap={assetColorMap}
            />
            <PortfolioPositionsTable hideValues={hideValues} rows={rowsWithWeight} />
          </>
        )}
      </div>
    </section>
  );
}
