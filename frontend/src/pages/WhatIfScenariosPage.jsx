import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteJson, fetchJson, postJson, putJson } from '../utils/api.js';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import { useDashboard } from '../contexts/DashboardContext.jsx';
import { formatCurrencyValue, formatMoney, formatPercent } from '../utils/formatters.js';
import { useDebouncedSearch } from '../hooks/useDebouncedSearch.js';
import { normalizeText, sanitizeDecimalInput } from '../utils/strings.js';
import './WhatIfScenariosPage.css';

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatPriceNumber(value, currency = 'USD') {
  const code = String(currency || 'USD').trim().toUpperCase();
  const locale = code === 'CNY' || code === 'RMB' ? 'zh-CN' : 'en-US';
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
  }).format(num(value));
}

function emptyStockForm() {
  return { query: '', selectedSymbol: '', qty: '', buyPrice: '' };
}

function emptyCryptoForm() {
  return { query: '', selectedProductId: '', qty: '', buyPrice: '' };
}

function inferAssetClass(row) {
  const currency = String(row?.currency || '').trim().toUpperCase();
  if (currency === 'USDT' || currency === 'USDC') return 'crypto';
  return 'stock';
}

export default function WhatIfScenariosPage({ hideValues }) {
  const { t } = useLanguage();
  const { netWorth, baseCurrency } = useDashboard();
  const [scenarios, setScenarios] = useState([]);
  const [activeScenarioId, setActiveScenarioId] = useState('');
  const [newScenarioName, setNewScenarioName] = useState('');
  const [isAddingScenario, setIsAddingScenario] = useState(false);
  const [targetPrices, setTargetPrices] = useState([]);
  const [targetPricePctBySymbol, setTargetPricePctBySymbol] = useState({});
  const [buyRows, setBuyRows] = useState([]);
  const [deductHypotheticalFromCash, setDeductHypotheticalFromCash] = useState(false);
  const [stockForm, setStockForm] = useState(emptyStockForm());
  const [cryptoForm, setCryptoForm] = useState(emptyCryptoForm());
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const skipNextAutoSaveRef = useRef(false);

  const fetchStockSymbols = useCallback(async (q) => {
    const res = await fetchJson('/api/market/us-stock-symbols', {
      params: new URLSearchParams({ q, limit: '50' }),
    });
    return Array.isArray(res?.symbols) ? res.symbols : [];
  }, []);

  const fetchCryptoProducts = useCallback(async (q) => {
    const res = await fetchJson('/api/market/coinbase-products', {
      params: new URLSearchParams({ q, limit: '100' }),
    });
    return Array.isArray(res?.products) ? res.products : [];
  }, []);

  const { items: stockSymbols, isLoading: isLoadingStockSymbols } = useDebouncedSearch(
    stockForm.query,
    Boolean(activeScenarioId),
    fetchStockSymbols,
    250,
    setError,
    t('errors.failedLoadSymbols'),
  );
  const { items: cryptoProducts, isLoading: isLoadingCryptoProducts } = useDebouncedSearch(
    cryptoForm.query,
    Boolean(activeScenarioId),
    fetchCryptoProducts,
    250,
    setError,
    t('errors.failedLoadProducts'),
  );

  async function loadScenarios() {
    const data = await fetchJson('/api/whatif/scenarios');
    const rows = Array.isArray(data?.scenarios) ? data.scenarios : [];
    setScenarios(rows);
    const activeId = data?.activeScenarioId || rows[0]?.id || '';
    setActiveScenarioId(activeId);
    return activeId;
  }

  async function loadScenarioPayload(scenarioId) {
    if (!scenarioId) {
      setTargetPrices([]);
      setTargetPricePctBySymbol({});
      setBuyRows([]);
      setStockForm(emptyStockForm());
      setCryptoForm(emptyCryptoForm());
      setResults(null);
      return;
    }
    const [targetsRes, buysRes, resultRes] = await Promise.all([
      fetchJson(`/api/whatif/scenarios/${scenarioId}/target-prices`),
      fetchJson(`/api/whatif/scenarios/${scenarioId}/hypothetical-purchases`),
      fetchJson(`/api/whatif/scenarios/${scenarioId}/results`),
    ]);
    const resultRows = Array.isArray(resultRes?.rows) ? resultRes.rows : [];
    const savedTargets = Array.isArray(targetsRes?.targetPrices) ? targetsRes.targetPrices : [];
    const savedBySymbol = new Map(savedTargets.map((row) => [String(row.symbol || '').toUpperCase(), row]));
    const prefilledTargets = resultRows.map((row) => {
      const symbol = String(row.symbol || '').toUpperCase();
      const saved = savedBySymbol.get(symbol);
      if (saved) {
        return {
          symbol,
          targetPrice: saved.targetPrice,
          currency: saved.currency || row.currency || 'USD',
        };
      }
      return {
        symbol,
        targetPrice: num(row.baselinePrice) > 0 ? row.baselinePrice : '',
        currency: row.currency || 'USD',
      };
    });
    const pctBySymbol = {};
    for (const row of resultRows) {
      const symbol = String(row.symbol || '').toUpperCase();
      const baseline = num(row.baselinePrice);
      const saved = savedBySymbol.get(symbol);
      const target = prefilledTargets.find((x) => String(x.symbol).toUpperCase() === symbol)?.targetPrice;
      const targetNum = num(target);
      // Keep % input empty by default; only prefill when a saved target price exists.
      pctBySymbol[symbol] =
        saved && baseline > 0 && target !== ''
          ? (((targetNum - baseline) / baseline) * 100).toFixed(2)
          : '';
    }
    setTargetPrices(prefilledTargets);
    setTargetPricePctBySymbol(pctBySymbol);
    const fetchedBuys = Array.isArray(buysRes?.hypotheticalPurchases) ? buysRes.hypotheticalPurchases : [];
    setBuyRows(
      fetchedBuys.map((row, index) => ({
        id: row.id || `saved-${index}`,
        assetClass: inferAssetClass(row),
        symbol: String(row.symbol || '').toUpperCase(),
        qty: row.qty,
        buyPrice: row.buyPrice,
        currency: String(row.currency || '').toUpperCase() || null,
      })),
    );
    setStockForm(emptyStockForm());
    setCryptoForm(emptyCryptoForm());
    setResults(resultRes);
    skipNextAutoSaveRef.current = true;
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setIsLoading(true);
        setError('');
        const activeId = await loadScenarios();
        if (!mounted) return;
        await loadScenarioPayload(activeId);
      } catch (err) {
        if (!mounted) return;
        setError(err?.message || t('errors.failedLoadData'));
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [t]);

  async function refreshCurrentScenario(scenarioId = activeScenarioId) {
    await loadScenarioPayload(scenarioId);
  }

  async function handleCreateScenario() {
    const name = String(newScenarioName || '').trim();
    if (!name) return;
    try {
      setIsSaving(true);
      setError('');
      const created = await postJson('/api/whatif/scenarios', { name, makeActive: true });
      const id = created?.scenario?.id;
      setNewScenarioName('');
      setIsAddingScenario(false);
      await loadScenarios();
      if (id) {
        setActiveScenarioId(id);
        await refreshCurrentScenario(id);
      }
    } catch (err) {
      setError(err?.message || t('errors.failedUpdate'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleActivateScenario(nextId) {
    if (!nextId) return;
    try {
      setIsSaving(true);
      setError('');
      await postJson(`/api/whatif/scenarios/${nextId}/activate`, {});
      setActiveScenarioId(nextId);
      await loadScenarios();
      await refreshCurrentScenario(nextId);
    } catch (err) {
      setError(err?.message || t('errors.failedUpdate'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteScenario() {
    if (!activeScenarioId) return;
    try {
      setIsSaving(true);
      setError('');
      await deleteJson(`/api/whatif/scenarios/${activeScenarioId}`);
      const nextId = await loadScenarios();
      await refreshCurrentScenario(nextId);
    } catch (err) {
      setError(err?.message || t('errors.failedDelete'));
    } finally {
      setIsSaving(false);
    }
  }

  function updateTargetPrice(symbol, value, currency) {
    const sym = String(symbol || '').trim().toUpperCase();
    const nextNum = value === '' ? '' : num(value);
    setTargetPrices((prev) => {
      const existing = prev.find((row) => String(row.symbol).toUpperCase() === sym);
      if (!existing) return [...prev, { symbol: sym, targetPrice: nextNum, currency: currency || '' }];
      return prev.map((row) =>
        String(row.symbol).toUpperCase() === sym
          ? { ...row, targetPrice: nextNum, currency: currency || row.currency }
          : row,
      );
    });
  }

  function updateTargetPricePct(symbol, value, baselinePrice, currency) {
    const sym = String(symbol || '').trim().toUpperCase();
    const baseline = num(baselinePrice);
    setTargetPricePctBySymbol((prev) => ({ ...prev, [sym]: value }));
    if (!baseline || value === '' || value === '-' || value === '.' || value === '-.') {
      return;
    }
    const pct = Number(value);
    if (!Number.isFinite(pct)) return;
    const target = baseline * (1 + pct / 100);
    updateTargetPrice(sym, target, currency);
  }

  function removeBuyRow(index) {
    setBuyRows((prev) => {
      return prev.filter((_, i) => i !== index);
    });
  }

  function addStockHypotheticalBuy() {
    const symbol = normalizeText(stockForm.selectedSymbol).toUpperCase();
    const qty = num(stockForm.qty);
    const buyPrice = num(stockForm.buyPrice);
    if (!symbol) {
      setError(t('errors.selectStockSymbol'));
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError(t('errors.quantityGreaterZero'));
      return;
    }
    if (!Number.isFinite(buyPrice) || buyPrice < 0) {
      setError(t('errors.avgCostNonNegative'));
      return;
    }
    setError('');
    setBuyRows((prev) => [
      ...prev,
      { id: `stock-${Date.now()}`, assetClass: 'stock', symbol, qty, buyPrice, currency: 'USD' },
    ]);
    setStockForm(emptyStockForm());
  }

  function addCryptoHypotheticalBuy() {
    const selected = cryptoProducts.find((item) => item.productId === cryptoForm.selectedProductId);
    const qty = num(cryptoForm.qty);
    const buyPrice = num(cryptoForm.buyPrice);
    if (!selected) {
      setError(t('errors.selectCoinbaseProduct'));
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError(t('errors.quantityGreaterZero'));
      return;
    }
    if (!Number.isFinite(buyPrice) || buyPrice < 0) {
      setError(t('errors.avgCostNonNegative'));
      return;
    }
    setError('');
    setBuyRows((prev) => [
      ...prev,
      {
        id: `crypto-${Date.now()}`,
        assetClass: 'crypto',
        symbol: String(selected.baseCurrency || '').toUpperCase(),
        qty,
        buyPrice,
        currency: String(selected.quoteCurrency || 'USD').toUpperCase(),
        productId: selected.productId,
      },
    ]);
    setCryptoForm(emptyCryptoForm());
  }

  const persistScenarioInputs = useCallback(
    async (scenarioId, nextTargetPrices, nextBuyRows) => {
      if (!scenarioId) return;
      const targetRows = nextTargetPrices
        .map((row) => ({
          symbol: String(row.symbol || '').trim().toUpperCase(),
          targetPrice: num(row.targetPrice),
          currency: String(row.currency || '').trim().toUpperCase() || null,
        }))
        .filter((row) => row.symbol && row.targetPrice > 0);
      const purchaseRows = nextBuyRows
        .map((row) => ({
          symbol: String(row.symbol || '').trim().toUpperCase(),
          qty: num(row.qty),
          buyPrice: num(row.buyPrice),
          currency: row.assetClass === 'stock' ? 'USD' : String(row.currency || '').trim().toUpperCase() || 'USD',
        }))
        .filter((row) => row.symbol && row.qty > 0 && row.buyPrice >= 0);

      setIsSaving(true);
      setError('');
      try {
        await Promise.all([
          putJson(`/api/whatif/scenarios/${scenarioId}/target-prices`, { rows: targetRows }),
          putJson(`/api/whatif/scenarios/${scenarioId}/hypothetical-purchases`, { rows: purchaseRows }),
        ]);
        const nextResults = await fetchJson(`/api/whatif/scenarios/${scenarioId}/results`);
        setResults(nextResults);
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeScenarioId) return;
    if (isLoading) return;
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        await persistScenarioInputs(activeScenarioId, targetPrices, buyRows);
      } catch (err) {
        setError(err?.message || t('errors.failedUpdate'));
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [activeScenarioId, buyRows, isLoading, persistScenarioInputs, t, targetPrices]);

  const resultRows = Array.isArray(results?.rows) ? results.rows : [];
  const baselineTotal = num(results?.baseline?.totalValue);
  const baselineCostBasis = num(results?.baseline?.totalCost);
  const baselineUnrealized = baselineTotal - baselineCostBasis;
  const baselineUnrealizedPct = baselineCostBasis > 0 ? (baselineUnrealized / baselineCostBasis) * 100 : 0;
  const scenarioTotal = num(results?.scenarioTotals?.value);
  const scenarioCostBasis = num(results?.scenarioTotals?.cost);
  const scenarioUnrealized = num(results?.scenarioTotals?.pnl);
  const scenarioUnrealizedPct = scenarioCostBasis > 0 ? (scenarioUnrealized / scenarioCostBasis) * 100 : 0;
  const unrealizedDelta = scenarioUnrealized - baselineUnrealized;
  const unrealizedDeltaPct = scenarioUnrealizedPct - baselineUnrealizedPct;
  const portfolioValueDelta = scenarioTotal - baselineTotal;
  const costBasisDelta = scenarioCostBasis - baselineCostBasis;
  const baselineNetWorth = num(netWorth?.overview?.totalNetWorth);
  const portfolioDeltaInBase = num(results?.portfolioBaseTotals?.deltaValue);
  const hypotheticalCostBase = num(results?.portfolioBaseTotals?.hypotheticalCostBase);
  const scenarioNetWorth = baselineNetWorth + portfolioDeltaInBase - (deductHypotheticalFromCash ? hypotheticalCostBase : 0);
  const netWorthDelta = scenarioNetWorth - baselineNetWorth;

  return (
    <section className="contentWrap">
      <header className="pageHeader">
        <h1>{t('whatif.title')}</h1>
      </header>

      <div className="dashboardPanel whatIfPanel">
        {isLoading && <p>{t('app.loadingDashboard')}</p>}
        {!isLoading && error && <p className="error">{error}</p>}
        {!isLoading && (
          <>
            <section className="whatIfSection">
              <h2>{t('whatif.scenarios')}</h2>
              <div className="whatIfScenarioControls">
                <label className="whatIfScenarioPicker">
                  <span className="whatIfScenarioPickerLabel">{t('whatif.activeScenarioLabel')}</span>
                  <select
                    className="profitabilitySelect"
                    value={activeScenarioId}
                    onChange={(e) => handleActivateScenario(e.target.value)}
                  >
                    <option value="">{t('whatif.selectScenario')}</option>
                    {scenarios.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="whatIfScenarioNameActions">
                  {isAddingScenario ? (
                    <>
                      <input
                        className="profitabilityInput"
                        value={newScenarioName}
                        onChange={(e) => setNewScenarioName(e.target.value)}
                        placeholder={t('whatif.newScenarioPlaceholder')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateScenario();
                          if (e.key === 'Escape') {
                            setIsAddingScenario(false);
                            setNewScenarioName('');
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="headerIconBtn whatIfIconBtn"
                        onClick={handleCreateScenario}
                        disabled={isSaving || !String(newScenarioName || '').trim()}
                        aria-label={t('modals.save')}
                        title={t('modals.save')}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className="headerIconBtn whatIfIconBtn"
                        onClick={() => {
                          setIsAddingScenario(false);
                          setNewScenarioName('');
                        }}
                        disabled={isSaving}
                        aria-label={t('modals.cancel')}
                        title={t('modals.cancel')}
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="headerIconBtn whatIfIconBtn"
                      onClick={() => setIsAddingScenario(true)}
                      disabled={isSaving}
                      aria-label={t('whatif.createScenario')}
                      title={t('whatif.createScenario')}
                    >
                      +
                    </button>
                  )}
                  <button
                    type="button"
                    className="headerIconBtn positionActionBtnDanger whatIfIconBtn"
                    onClick={handleDeleteScenario}
                    disabled={!activeScenarioId || isSaving}
                    aria-label={t('whatif.deleteScenario')}
                    title={t('whatif.deleteScenario')}
                  >
                    -
                  </button>
                </div>
              </div>
            </section>

            {activeScenarioId && (
              <>
                <section className="whatIfSection">
                  <h2>{t('whatif.featureATitle')}</h2>
                  <p className="profitabilitySectionDesc">{t('whatif.featureADesc')}</p>
                  <div className="profitabilityTableWrap">
                    <table className="profitabilityTable whatIfTable whatIfTableTarget">
                      <thead>
                        <tr>
                          <th>{t('portfolio.asset')}</th>
                          <th>{`${t('whatif.currentPrice')} $`}</th>
                          <th>{t('whatif.targetDeltaVsCurrentPct')}</th>
                          <th>{`${t('whatif.targetPrice')} $`}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultRows.map((row) => {
                          const targetRow = targetPrices.find((x) => String(x.symbol).toUpperCase() === String(row.symbol).toUpperCase());
                          const targetCurrency = targetRow?.currency || row.currency || 'USD';
                          return (
                            <tr key={row.symbol}>
                              <td data-label={t('portfolio.asset')}>{row.symbol}</td>
                              <td data-label={`${t('whatif.currentPrice')} $`}>
                                {hideValues
                                  ? '—'
                                  : formatPriceNumber(row.baselinePrice, targetCurrency)}
                              </td>
                              <td data-label={t('whatif.targetDeltaVsCurrentPct')}>
                                <input
                                  type="number"
                                  step="0.1"
                                  className="profitabilityInput"
                                  value={targetPricePctBySymbol[row.symbol] ?? ''}
                                  onChange={(e) =>
                                    updateTargetPricePct(
                                      row.symbol,
                                      e.target.value,
                                      row.baselinePrice,
                                      targetCurrency,
                                    )
                                  }
                                  placeholder="0.0"
                                  disabled={num(row.baselinePrice) <= 0}
                                />
                              </td>
                              <td data-label={`${t('whatif.targetPrice')} $`}>
                                <span className="strategyRebalanceTargetWrap">
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.0001"
                                    className="profitabilityInput"
                                    value={targetRow?.targetPrice ?? ''}
                                    onChange={(e) => {
                                      const nextVal = e.target.value;
                                      updateTargetPrice(row.symbol, nextVal, targetCurrency);
                                      const baseline = num(row.baselinePrice);
                                      const nextNum = num(nextVal);
                                      setTargetPricePctBySymbol((prev) => ({
                                        ...prev,
                                        [row.symbol]:
                                          baseline > 0 && nextVal !== ''
                                            ? (((nextNum - baseline) / baseline) * 100).toFixed(2)
                                            : '',
                                      }));
                                    }}
                                  />
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="whatIfSection">
                  <h2>{t('whatif.featureBTitle')}</h2>
                  <p className="profitabilitySectionDesc">{t('whatif.featureBDesc')}</p>
                  <div className="whatIfBuyForms">
                    <div className="whatIfBuyCard">
                      <div className="whatIfBuyCardHeader">
                        <h3>{t('portfolio.stockPosition')}</h3>
                        <button
                          type="button"
                          className="headerIconBtn whatIfIconBtn"
                          onClick={addStockHypotheticalBuy}
                          aria-label={t('whatif.addHypotheticalBuy')}
                          title={t('whatif.addHypotheticalBuy')}
                        >
                          +
                        </button>
                      </div>
                      <label className="modalLabel">
                        {t('modals.asset')}
                        <input
                          className="profitabilityInput"
                          value={stockForm.query}
                          onChange={(e) => {
                            const nextQuery = e.target.value;
                            setStockForm((prev) => ({ ...prev, query: nextQuery, selectedSymbol: '' }));
                          }}
                          placeholder={t('modals.placeholderStock')}
                        />
                      </label>
                      {!stockForm.selectedSymbol && normalizeText(stockForm.query) && (
                        <div className="modalProductList">
                          {isLoadingStockSymbols && <p className="modalHint">{t('modals.loadingSymbols')}</p>}
                          {!isLoadingStockSymbols && stockSymbols.length === 0 && (
                            <p className="modalHint">{t('modals.noMatchingStock')}</p>
                          )}
                          {!isLoadingStockSymbols && stockSymbols.length > 0 && (
                            <ul>
                              {stockSymbols.map((item) => (
                                <li key={item.symbol}>
                                  <button
                                    type="button"
                                    className="modalProductItem"
                                    onClick={() =>
                                      setStockForm((prev) => ({
                                        ...prev,
                                        selectedSymbol: item.symbol,
                                        query: item.symbol,
                                      }))
                                    }
                                  >
                                    <span className="modalProductMain">{item.symbol}</span>
                                    {item.securityName && <span className="modalProductSub">{item.securityName}</span>}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                      <div className="modalGrid">
                        <label className="modalLabel">
                          {t('portfolio.quantity')}
                          <input
                            className="profitabilityInput"
                            type="text"
                            inputMode="decimal"
                            value={stockForm.qty}
                            onChange={(e) =>
                              setStockForm((prev) => ({
                                ...prev,
                                qty: sanitizeDecimalInput(e.target.value, { allowNegative: false }),
                              }))
                            }
                          />
                        </label>
                        <label className="modalLabel">
                          {t('modals.avgCostPerUnit')}
                          <input
                            className="profitabilityInput"
                            type="text"
                            inputMode="decimal"
                            value={stockForm.buyPrice}
                            onChange={(e) =>
                              setStockForm((prev) => ({
                                ...prev,
                                buyPrice: sanitizeDecimalInput(e.target.value, { allowNegative: false }),
                              }))
                            }
                          />
                        </label>
                      </div>
                    </div>

                    <div className="whatIfBuyCard">
                      <div className="whatIfBuyCardHeader">
                        <h3>{t('portfolio.cryptoPosition')}</h3>
                        <button
                          type="button"
                          className="headerIconBtn whatIfIconBtn"
                          onClick={addCryptoHypotheticalBuy}
                          aria-label={t('whatif.addHypotheticalBuy')}
                          title={t('whatif.addHypotheticalBuy')}
                        >
                          +
                        </button>
                      </div>
                      <label className="modalLabel">
                        {t('modals.asset')}
                        <input
                          className="profitabilityInput"
                          value={cryptoForm.query}
                          onChange={(e) => {
                            const nextQuery = e.target.value;
                            setCryptoForm((prev) => ({ ...prev, query: nextQuery, selectedProductId: '' }));
                          }}
                          placeholder={t('modals.placeholderCrypto')}
                        />
                      </label>
                      {!cryptoForm.selectedProductId && normalizeText(cryptoForm.query) && (
                        <div className="modalProductList">
                          {isLoadingCryptoProducts && <p className="modalHint">{t('modals.loadingProducts')}</p>}
                          {!isLoadingCryptoProducts && cryptoProducts.length === 0 && (
                            <p className="modalHint">{t('modals.noMatchingCrypto')}</p>
                          )}
                          {!isLoadingCryptoProducts && cryptoProducts.length > 0 && (
                            <ul>
                              {cryptoProducts.map((item) => (
                                <li key={item.productId}>
                                  <button
                                    type="button"
                                    className="modalProductItem"
                                    onClick={() =>
                                      setCryptoForm((prev) => ({
                                        ...prev,
                                        selectedProductId: item.productId,
                                        query: item.productId,
                                      }))
                                    }
                                  >
                                    <span className="modalProductMain">
                                      {item.baseCurrency}/{item.quoteCurrency}
                                    </span>
                                    <span className="modalProductSub">{item.productId}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                      <div className="modalGrid">
                        <label className="modalLabel">
                          {t('portfolio.quantity')}
                          <input
                            className="profitabilityInput"
                            type="text"
                            inputMode="decimal"
                            value={cryptoForm.qty}
                            onChange={(e) =>
                              setCryptoForm((prev) => ({
                                ...prev,
                                qty: sanitizeDecimalInput(e.target.value, { allowNegative: false }),
                              }))
                            }
                          />
                        </label>
                        <label className="modalLabel">
                          {t('modals.avgCostPerUnit')}
                          <input
                            className="profitabilityInput"
                            type="text"
                            inputMode="decimal"
                            value={cryptoForm.buyPrice}
                            onChange={(e) =>
                              setCryptoForm((prev) => ({
                                ...prev,
                                buyPrice: sanitizeDecimalInput(e.target.value, { allowNegative: false }),
                              }))
                            }
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="profitabilityTableWrap">
                    <table className="profitabilityTable whatIfTable whatIfTablePurchases">
                      <thead>
                        <tr>
                          <th>{t('portfolio.assetClass')}</th>
                          <th>{t('portfolio.asset')}</th>
                          <th>{t('portfolio.quantity')}</th>
                          <th>{t('modals.avgCostPerUnit')}</th>
                          <th>{t('netWorth.actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {buyRows.map((row, index) => (
                          <tr key={`${row.id || index}-${row.symbol}`}>
                            <td data-label={t('portfolio.assetClass')}>{row.assetClass === 'crypto' ? t('portfolio.cryptoPosition') : t('portfolio.stockPosition')}</td>
                            <td data-label={t('portfolio.asset')}>{row.symbol}</td>
                            <td data-label={t('portfolio.quantity')}>{row.qty}</td>
                            <td data-label={t('modals.avgCostPerUnit')}>{row.buyPrice}</td>
                            <td data-label={t('netWorth.actions')}>
                              <button
                                type="button"
                                className="headerIconBtn positionActionBtnDanger whatIfIconBtn"
                                onClick={() => removeBuyRow(index)}
                                aria-label={t('modals.remove')}
                                title={t('modals.remove')}
                              >
                                -
                              </button>
                            </td>
                          </tr>
                        ))}
                        {buyRows.length === 0 && (
                          <tr>
                            <td colSpan={5}>{t('whatif.noHypotheticalPurchases')}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="whatIfSection">
                  <h2>{t('whatif.resultsTitle')}</h2>
                  <label className="whatIfToggleRow">
                    <input
                      type="checkbox"
                      className="whatIfToggleInput"
                      checked={deductHypotheticalFromCash}
                      onChange={(e) => setDeductHypotheticalFromCash(e.target.checked)}
                    />
                    <span className="whatIfToggleSwitch" aria-hidden="true" />
                    <span className="whatIfToggleText">{t('whatif.netWorthUseCashFunding')}</span>
                  </label>
                  <div className="profitabilitySellDownResult strategyKpiRow">
                    <div className="profitabilityCard">
                      <span className="profitabilityCardLabel">{t('whatif.baselineNetWorth')}</span>
                      <span className="profitabilityCardValue">
                        {hideValues ? '—' : formatCurrencyValue(baselineNetWorth, baseCurrency)}
                      </span>
                    </div>
                    <div className="profitabilityCard">
                      <span className="profitabilityCardLabel">{t('whatif.scenarioNetWorth')}</span>
                      <span className="profitabilityCardValue">
                        {hideValues ? '—' : formatCurrencyValue(scenarioNetWorth, baseCurrency)}
                      </span>
                    </div>
                    <div className="profitabilityCard">
                      <span className="profitabilityCardLabel">{t('whatif.netWorthDelta')}</span>
                      <span className={`profitabilityCardValue ${netWorthDelta >= 0 ? 'pos' : 'neg'}`}>
                        {hideValues ? '—' : formatCurrencyValue(netWorthDelta, baseCurrency)}
                      </span>
                    </div>
                  </div>

                  <div className="profitabilitySellDownResult strategyKpiRow">
                    <div className="profitabilityCard">
                      <span className="profitabilityCardLabel">{t('whatif.baselineUnrealizedPl')}</span>
                      <span className={`profitabilityCardValue ${baselineUnrealized >= 0 ? 'pos' : 'neg'}`}>
                        {hideValues ? '—' : formatMoney(baselineUnrealized)}
                      </span>
                      <small className={`profitabilityCardSub ${baselineUnrealized >= 0 ? 'pos' : 'neg'}`}>
                        {hideValues ? '—' : formatPercent(baselineUnrealizedPct)}
                      </small>
                    </div>
                    <div className="profitabilityCard">
                      <span className="profitabilityCardLabel">{t('whatif.scenarioUnrealizedPl')}</span>
                      <span className={`profitabilityCardValue ${scenarioUnrealized >= 0 ? 'pos' : 'neg'}`}>
                        {hideValues ? '—' : formatMoney(scenarioUnrealized)}
                      </span>
                      <small className={`profitabilityCardSub ${scenarioUnrealized >= 0 ? 'pos' : 'neg'}`}>
                        {hideValues ? '—' : formatPercent(scenarioUnrealizedPct)}
                      </small>
                    </div>
                    <div className="profitabilityCard">
                      <span className="profitabilityCardLabel">{t('whatif.plDelta')}</span>
                      <span className={`profitabilityCardValue ${unrealizedDelta >= 0 ? 'pos' : 'neg'}`}>
                        {hideValues ? '—' : formatMoney(unrealizedDelta)}
                      </span>
                      <small className={`profitabilityCardSub ${unrealizedDeltaPct >= 0 ? 'pos' : 'neg'}`}>
                        {hideValues ? '—' : formatPercent(unrealizedDeltaPct)}
                      </small>
                    </div>
                  </div>

                  <div className="profitabilitySellDownResult strategyKpiRow">
                    <div className="profitabilityCard">
                      <span className="profitabilityCardLabel">{t('whatif.baselineValue')}</span>
                      <span className="profitabilityCardValue">{hideValues ? '—' : formatMoney(baselineTotal)}</span>
                    </div>
                    <div className="profitabilityCard">
                      <span className="profitabilityCardLabel">{t('whatif.scenarioValue')}</span>
                      <span className="profitabilityCardValue">{hideValues ? '—' : formatMoney(scenarioTotal)}</span>
                    </div>
                    <div className="profitabilityCard">
                      <span className="profitabilityCardLabel">{t('whatif.portfolioValueDelta')}</span>
                      <span className={`profitabilityCardValue ${portfolioValueDelta >= 0 ? 'pos' : 'neg'}`}>
                        {hideValues ? '—' : formatMoney(portfolioValueDelta)}
                      </span>
                    </div>
                  </div>

                  <div className="profitabilitySellDownResult strategyKpiRow">
                    <div className="profitabilityCard">
                      <span className="profitabilityCardLabel">{t('whatif.baselineCostBasis')}</span>
                      <span className="profitabilityCardValue">{hideValues ? '—' : formatMoney(baselineCostBasis)}</span>
                    </div>
                    <div className="profitabilityCard">
                      <span className="profitabilityCardLabel">{t('whatif.scenarioCostBasis')}</span>
                      <span className="profitabilityCardValue">{hideValues ? '—' : formatMoney(scenarioCostBasis)}</span>
                    </div>
                    <div className="profitabilityCard">
                      <span className="profitabilityCardLabel">{t('whatif.costBasisDelta')}</span>
                      <span className={`profitabilityCardValue ${costBasisDelta >= 0 ? 'pos' : 'neg'}`}>
                        {hideValues ? '—' : formatMoney(costBasisDelta)}
                      </span>
                    </div>
                  </div>

                  <div className="profitabilityTableWrap">
                    <table className="profitabilityTable whatIfTable whatIfTableResults">
                      <thead>
                        <tr>
                          <th>{t('portfolio.asset')}</th>
                          <th>{t('portfolio.quantity')}</th>
                          <th>{t('whatif.scenarioPrice')}</th>
                          <th>{t('portfolio.marketValue')}</th>
                          <th>{t('portfolio.portfolioWeight')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultRows.map((row) => (
                          <tr key={row.symbol}>
                            <td data-label={t('portfolio.asset')}>{row.symbol}</td>
                            <td data-label={t('portfolio.quantity')}>{row.qty}</td>
                            <td data-label={t('whatif.scenarioPrice')}>{hideValues ? '—' : formatCurrencyValue(row.scenarioPrice, row.currency || 'USD')}</td>
                            <td data-label={t('portfolio.marketValue')}>{hideValues ? '—' : formatCurrencyValue(row.scenarioValue, row.currency || 'USD')}</td>
                            <td data-label={t('portfolio.portfolioWeight')}>{formatPercent(row.scenarioWeightPct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {isSaving && <p className="hint">{t('modals.saving')}</p>}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
