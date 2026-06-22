import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useDashboard } from '../contexts/DashboardContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import { deleteJson, fetchJson, postJson } from '../utils/api';

// ─── tiny helpers ────────────────────────────────────────────────────────────

const fmt = (n, currency = 'USD', decimals = 2) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);

const pct = (n, decimals = 2) =>
  `${n >= 0 ? '+' : ''}${Number(n).toFixed(decimals)}%`;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// one sig-fig step for a given magnitude
const niceStep = (range) => {
  if (range <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(range)));
  return mag; // 1 × 10^n
};

// ─── modal component ─────────────────────────────────────────────────────────

function ScenarioModal({ scenario, onClose, onSave, isSaving, currency, t }) {
  const isEdit = !!scenario?.id;
  const [name, setName] = useState(scenario?.name ?? '');
  const [desc, setDesc] = useState(scenario?.description ?? '');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), description: desc.trim() });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#1e2433] rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-semibold text-white mb-4">
          {isEdit ? t('whatIf.editScenario') : t('whatIf.newScenario')}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">
              {t('whatIf.scenarioName')}
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#252d3d] text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('whatIf.scenarioNamePlaceholder')}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">
              {t('whatIf.description')}
            </label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              className="w-full bg-[#252d3d] text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder={t('whatIf.descriptionPlaceholder')}
            />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:bg-[#252d3d] transition"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSaving || !name.trim()}
              className="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50 transition"
            >
              {isSaving ? t('modals.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── scenario selector sidebar ───────────────────────────────────────────────

function ScenarioSidebar({
  scenarios,
  activeId,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  t,
}) {
  return (
    <aside className="w-64 shrink-0 flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
          {t('whatIf.scenarios')}
        </h2>
        <button
          onClick={onCreate}
          className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded-lg transition"
        >
          + {t('whatIf.new')}
        </button>
      </div>

      {scenarios.length === 0 && (
        <p className="text-slate-500 text-xs mt-2">{t('whatIf.noScenarios')}</p>
      )}

      {scenarios.map((s) => (
        <div
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={`group relative cursor-pointer rounded-xl px-3 py-2.5 transition ${
            s.id === activeId
              ? 'bg-blue-600/20 ring-1 ring-blue-500'
              : 'bg-[#1e2433] hover:bg-[#252d3d]'
          }`}
        >
          <p className="text-sm font-medium text-white truncate pr-10">{s.name}</p>
          {s.description && (
            <p className="text-xs text-slate-400 truncate mt-0.5">{s.description}</p>
          )}
          <div className="absolute right-2 top-2 hidden group-hover:flex gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(s);
              }}
              className="text-slate-400 hover:text-white p-0.5"
              title={t('common.edit')}
            >
              ✏️
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(s.id);
              }}
              className="text-slate-400 hover:text-red-400 p-0.5"
              title={t('common.delete')}
            >
              🗑️
            </button>
          </div>
        </div>
      ))}
    </aside>
  );
}

// ─── single adjustment row ────────────────────────────────────────────────────

function AdjRow({ adj, onUpdate, onRemove, t }) {
  const pctVal = Number(adj.change_pct);

  const handleSlider = (e) => {
    onUpdate({ ...adj, change_pct: Number(e.target.value) });
  };

  const handleInput = (e) => {
    const v = clamp(parseFloat(e.target.value) || 0, -99, 500);
    onUpdate({ ...adj, change_pct: v });
  };

  const color =
    pctVal > 0 ? 'text-emerald-400' : pctVal < 0 ? 'text-red-400' : 'text-slate-400';

  return (
    <div className="flex items-center gap-3 bg-[#1e2433] rounded-xl px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{adj.asset_label}</p>
        <p className="text-xs text-slate-500">{adj.asset_type}</p>
      </div>

      {/* slider */}
      <input
        type="range"
        min={-99}
        max={500}
        step={1}
        value={pctVal}
        onChange={handleSlider}
        className="w-32 accent-blue-500"
      />

      {/* numeric input */}
      <input
        type="number"
        min={-99}
        max={500}
        step={0.1}
        value={pctVal}
        onChange={handleInput}
        className={`w-20 bg-[#252d3d] rounded-lg px-2 py-1 text-sm text-right outline-none focus:ring-2 focus:ring-blue-500 ${color}`}
      />
      <span className="text-slate-400 text-sm">%</span>

      <button
        onClick={() => onRemove(adj.asset_key)}
        className="text-slate-500 hover:text-red-400 transition text-lg leading-none"
        title={t('common.remove')}
      >
        ×
      </button>
    </div>
  );
}

// ─── asset picker ─────────────────────────────────────────────────────────────

function AssetPicker({ positions, existingKeys, onAdd, t }) {
  const [query, setQuery] = useState('');
  const available = positions.filter(
    (p) => !existingKeys.has(p.asset_key) && p.asset_label.toLowerCase().includes(query.toLowerCase())
  );

  if (positions.length === 0) return null;

  return (
    <div className="bg-[#1e2433] rounded-xl p-4">
      <p className="text-sm text-slate-400 mb-2">{t('whatIf.addAsset')}</p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('whatIf.searchAssets')}
        className="w-full bg-[#252d3d] text-white rounded-lg px-3 py-1.5 text-sm outline-none mb-2 focus:ring-2 focus:ring-blue-500"
      />
      <div className="max-h-40 overflow-y-auto space-y-1">
        {available.map((p) => (
          <button
            key={p.asset_key}
            onClick={() => onAdd(p)}
            className="w-full text-left text-sm px-3 py-1.5 rounded-lg hover:bg-[#252d3d] text-white transition"
          >
            {p.asset_label}
            <span className="text-slate-500 ml-2 text-xs">{p.asset_type}</span>
          </button>
        ))}
        {available.length === 0 && (
          <p className="text-xs text-slate-500 px-1">{t('whatIf.noAssetsFound')}</p>
        )}
      </div>
    </div>
  );
}

// ─── bar chart tooltip ────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, currency }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#1e2433] rounded-xl shadow-lg px-4 py-3 text-sm">
      <p className="text-white font-medium mb-1">{d.label}</p>
      <p className="text-slate-400">
        {fmt(d.current, currency)} → <span className="text-white">{fmt(d.projected, currency)}</span>
      </p>
      <p className={d.delta >= 0 ? 'text-emerald-400' : 'text-red-400'}>
        {d.delta >= 0 ? '+' : ''}{fmt(d.delta, currency)} ({pct(d.pct)})
      </p>
    </div>
  );
}

// ─── results panel ────────────────────────────────────────────────────────────

function ResultsPanel({ result, currency, t }) {
  if (!result) return null;

  const { baseline_net_worth, projected_net_worth, delta, delta_pct, breakdown } = result;
  const isUp = delta >= 0;

  // chart data
  const chartData = (breakdown || []).map((b) => ({
    label: b.asset_label,
    current: b.current_value_usd,
    projected: b.projected_value_usd,
    delta: b.delta_usd,
    pct: b.change_pct,
  }));

  // Y-axis domain
  const allVals = chartData.flatMap((d) => [d.current, d.projected]);
  const minVal = Math.min(...allVals, 0);
  const maxVal = Math.max(...allVals, 0);
  const range = maxVal - minVal;
  const step = niceStep(range);
  const yMin = Math.floor(minVal / step) * step;
  const yMax = Math.ceil(maxVal / step) * step;

  return (
    <div className="space-y-6">
      {/* summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[#1e2433] rounded-2xl p-4">
          <p className="text-xs text-slate-400 mb-1">{t('whatIf.baseline')}</p>
          <p className="text-lg font-semibold text-white">{fmt(baseline_net_worth, currency)}</p>
        </div>
        <div className="bg-[#1e2433] rounded-2xl p-4">
          <p className="text-xs text-slate-400 mb-1">{t('whatIf.projected')}</p>
          <p className="text-lg font-semibold text-white">{fmt(projected_net_worth, currency)}</p>
        </div>
        <div className={`rounded-2xl p-4 ${isUp ? 'bg-emerald-900/30' : 'bg-red-900/30'}`}>
          <p className="text-xs text-slate-400 mb-1">{t('whatIf.change')}</p>
          <p className={`text-lg font-semibold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
            {isUp ? '+' : ''}{fmt(delta, currency)}
          </p>
          <p className={`text-xs ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
            {pct(delta_pct)}
          </p>
        </div>
      </div>

      {/* bar chart */}
      {chartData.length > 0 && (
        <div className="bg-[#1e2433] rounded-2xl p-4">
          <p className="text-sm text-slate-400 mb-3">{t('whatIf.breakdownChart')}</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3347" />
              <XAxis
                dataKey="label"
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                angle={-35}
                textAnchor="end"
                interval={0}
              />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickFormatter={(v) => fmt(v, currency, 0)}
                domain={[yMin, yMax]}
                width={90}
              />
              <Tooltip content={<ChartTooltip currency={currency} />} />
              <Bar dataKey="current" name={t('whatIf.current')} fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar
                dataKey="projected"
                name={t('whatIf.projected')}
                radius={[4, 4, 0, 0]}
                shape={(props) => {
                  const { projected, current } = props;
                  const fill = projected >= current ? '#10b981' : '#ef4444';
                  return <Rectangle {...props} fill={fill} />;
                }}
              >
                <LabelList
                  dataKey="pct"
                  position="top"
                  formatter={(v) => pct(v, 0)}
                  style={{ fill: '#94a3b8', fontSize: 10 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* breakdown table */}
      {breakdown?.length > 0 && (
        <div className="bg-[#1e2433] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a3347]">
                <th className="text-left px-4 py-3 text-slate-400 font-medium">{t('whatIf.asset')}</th>
                <th className="text-right px-4 py-3 text-slate-400 font-medium">{t('whatIf.current')}</th>
                <th className="text-right px-4 py-3 text-slate-400 font-medium">{t('whatIf.adjPct')}</th>
                <th className="text-right px-4 py-3 text-slate-400 font-medium">{t('whatIf.projected')}</th>
                <th className="text-right px-4 py-3 text-slate-400 font-medium">{t('whatIf.impact')}</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((b, i) => (
                <tr
                  key={b.asset_key}
                  className={`border-b border-[#2a3347]/50 ${
                    i % 2 === 0 ? 'bg-[#1a2030]/40' : ''
                  }`}
                >
                  <td className="px-4 py-2.5 text-white">{b.asset_label}</td>
                  <td className="px-4 py-2.5 text-right text-slate-300">
                    {fmt(b.current_value_usd, currency)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-medium ${
                      b.change_pct > 0
                        ? 'text-emerald-400'
                        : b.change_pct < 0
                        ? 'text-red-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {pct(b.change_pct)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-white">
                    {fmt(b.projected_value_usd, currency)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-medium ${
                      b.delta_usd >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {b.delta_usd >= 0 ? '+' : ''}{fmt(b.delta_usd, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function WhatIfScenariosPage() {
  const { data: dashData, loading: dashLoading } = useDashboard();
  const { t } = useLanguage();
  const { showToast } = useToast();

  const currency = dashData?.userSettings?.base_currency ?? 'USD';

  // ── scenario list state ──
  const [scenarios, setScenarios] = useState([]);
  const [loadingScenarios, setLoadingScenarios] = useState(true);
  const [activeId, setActiveId] = useState(null);

  // ── modal state ──
  const [modal, setModal] = useState(null); // null | 'create' | scenario-obj
  const [isSaving, setIsSaving] = useState(false);

  // ── active scenario detail ──
  const [detail, setDetail] = useState(null); // { adjustments: [] }
  const [loadingDetail, setLoadingDetail] = useState(false);

  // ── simulation result ──
  const [result, setResult] = useState(null);
  const [simulating, setSimulating] = useState(false);

  // ── positions from dashboard ──
  const positions = useMemo(() => {
    if (!dashData?.portfolio?.positions) return [];
    return dashData.portfolio.positions.map((p) => ({
      asset_key: p.asset_key ?? `${p.asset_type}:${p.symbol}`,
      asset_label: p.name ?? p.symbol,
      asset_type: p.asset_type,
    }));
  }, [dashData]);

  // ── load scenario list ──
  useEffect(() => {
    fetchJson('/api/whatif/scenarios')
      .then((data) => {
        setScenarios(data.scenarios ?? []);
        if (data.scenarios?.length > 0 && !activeId) {
          setActiveId(data.scenarios[0].id);
        }
      })
      .catch(() => showToast(t('whatIf.errorLoadingScenarios'), 'error'))
      .finally(() => setLoadingScenarios(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── load active scenario detail ──
  useEffect(() => {
    if (!activeId) { setDetail(null); setResult(null); return; }
    setLoadingDetail(true);
    setResult(null);
    fetchJson(`/api/whatif/scenarios/${activeId}`)
      .then((d) => setDetail(d))
      .catch(() => showToast(t('whatIf.errorLoadingDetail'), 'error'))
      .finally(() => setLoadingDetail(false));
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── handlers ──

  const handleCreate = () => setModal('create');
  const handleEdit = (s) => setModal(s);
  const handleCloseModal = () => setModal(null);

  const handleSave = async ({ name, description }) => {
    setIsSaving(true);
    try {
      if (modal === 'create') {
        const res = await postJson('/api/whatif/scenarios', { name, description });
        const newS = res.scenario;
        setScenarios((prev) => [...prev, newS]);
        setActiveId(newS.id);
      } else {
        const res = await postJson(`/api/whatif/scenarios/${modal.id}`, { name, description });
        const updated = res.scenario;
        setScenarios((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      }
      setModal(null);
    } catch {
      showToast(t('whatIf.errorSavingScenario'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('whatIf.confirmDelete'))) return;
    try {
      await deleteJson(`/api/whatif/scenarios/${id}`);
      setScenarios((prev) => prev.filter((s) => s.id !== id));
      if (activeId === id) {
        const remaining = scenarios.filter((s) => s.id !== id);
        setActiveId(remaining[0]?.id ?? null);
      }
    } catch {
      showToast(t('whatIf.errorDeletingScenario'), 'error');
    }
  };

  // adjustment CRUD
  const handleAddAdj = async (position) => {
    if (!activeId) return;
    try {
      const res = await postJson(`/api/whatif/scenarios/${activeId}/adjustments`, {
        asset_key: position.asset_key,
        asset_label: position.asset_label,
        asset_type: position.asset_type,
        change_pct: 0,
      });
      setDetail((prev) => ({
        ...prev,
        adjustments: [...(prev?.adjustments ?? []), res.adjustment],
      }));
      setResult(null);
    } catch {
      showToast(t('whatIf.errorAddingAdjustment'), 'error');
    }
  };

  // debounce update
  const updateTimers = useRef({});
  const handleUpdateAdj = (updated) => {
    // optimistic UI
    setDetail((prev) => ({
      ...prev,
      adjustments: prev.adjustments.map((a) =>
        a.asset_key === updated.asset_key ? updated : a
      ),
    }));
    setResult(null);

    clearTimeout(updateTimers.current[updated.asset_key]);
    updateTimers.current[updated.asset_key] = setTimeout(async () => {
      try {
        await postJson(
          `/api/whatif/scenarios/${activeId}/adjustments/${encodeURIComponent(updated.asset_key)}`,
          { change_pct: updated.change_pct }
        );
      } catch {
        showToast(t('whatIf.errorUpdatingAdjustment'), 'error');
      }
    }, 600);
  };

  const handleRemoveAdj = async (assetKey) => {
    try {
      await deleteJson(
        `/api/whatif/scenarios/${activeId}/adjustments/${encodeURIComponent(assetKey)}`
      );
      setDetail((prev) => ({
        ...prev,
        adjustments: prev.adjustments.filter((a) => a.asset_key !== assetKey),
      }));
      setResult(null);
    } catch {
      showToast(t('whatIf.errorRemovingAdjustment'), 'error');
    }
  };

  const handleSimulate = useCallback(async () => {
    if (!activeId) return;
    setSimulating(true);
    try {
      const res = await postJson(`/api/whatif/scenarios/${activeId}/simulate`, {});
      setResult(res);
    } catch {
      showToast(t('whatIf.errorSimulating'), 'error');
    } finally {
      setSimulating(false);
    }
  }, [activeId, showToast, t]);

  // ── derived ──
  const existingKeys = useMemo(
    () => new Set((detail?.adjustments ?? []).map((a) => a.asset_key)),
    [detail]
  );

  const isLoading = dashLoading || loadingScenarios;

  // ── render ──
  return (
    <section className="min-h-screen bg-[#0f1623] text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">{t('whatIf.title')}</h1>
          <p className="text-slate-400 text-sm mt-1">{t('whatIf.subtitle')}</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-slate-400">{t('app.loading')}</div>
          </div>
        ) : (
          <div className="flex gap-6">
            {/* sidebar */}
            <ScenarioSidebar
              scenarios={scenarios}
              activeId={activeId}
              onSelect={setActiveId}
              onCreate={handleCreate}
              onEdit={handleEdit}
              onDelete={handleDelete}
              t={t}
            />

            {/* main content */}
            <div className="flex-1 min-w-0 space-y-6">
              {activeId === null ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                  <p className="text-lg">{t('whatIf.selectOrCreate')}</p>
                </div>
              ) : loadingDetail ? (
                <div className="flex items-center justify-center h-32">
                  <div className="text-slate-400">{t('app.loading')}</div>
                </div>
              ) : (
                <Fragment>
                  {/* adjustments */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-semibold text-white">
                        {t('whatIf.adjustments')}
                      </h2>
                      <button
                        onClick={handleSimulate}
                        disabled={simulating || (detail?.adjustments?.length ?? 0) === 0}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-medium transition"
                      >
                        {simulating ? (
                          <>
                            <span className="animate-spin">⏳</span>
                            {t('whatIf.simulating')}
                          </>
                        ) : (
                          <>
                            ▶ {t('whatIf.runSimulation')}
                          </>
                        )}
                      </button>
                    </div>

                    {(detail?.adjustments ?? []).length === 0 ? (
                      <p className="text-slate-500 text-sm">{t('whatIf.noAdjustments')}</p>
                    ) : (
                      (detail.adjustments).map((adj) => (
                        <AdjRow
                          key={adj.asset_key}
                          adj={adj}
                          onUpdate={handleUpdateAdj}
                          onRemove={handleRemoveAdj}
                          t={t}
                        />
                      ))
                    )}
                  </div>

                  {/* asset picker */}
                  <AssetPicker
                    positions={positions}
                    existingKeys={existingKeys}
                    onAdd={handleAddAdj}
                    t={t}
                  />

                  {/* results */}
                  <ResultsPanel result={result} currency={currency} t={t} />
                </Fragment>
              )}
            </div>
          </div>
        )}
      </div>

      {/* modal */}
      {modal && (
        <ScenarioModal
          scenario={modal === 'create' ? null : modal}
          onClose={handleCloseModal}
          onSave={handleSave}
          isSaving={isSaving}
          currency={currency}
          t={t}
        />
      )}

      {/* global loading overlay (initial dashboard load) */}
      {dashLoading && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center">
          <div className="bg-[#1e2433] rounded-2xl px-8 py-6 text-center">
            <div className="animate-spin text-3xl mb-3">⏳</div>
            <div className="text-white">
              {isSaving
                    ? t('modals.saving')
                    : t('app.loadingDashboard')}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
