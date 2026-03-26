import { useMemo } from 'react';
import { useDashboard } from '../contexts/DashboardContext.jsx';
import useApiData from '../hooks/useApiData.js';

function formatMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return '-';
  if (n < 1000) return `${Math.round(n)}ms`;
  const sec = n / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = sec / 60;
  if (min < 60) return `${min.toFixed(1)}m`;
  const hr = min / 60;
  return `${hr.toFixed(1)}h`;
}

function summarizeCacheValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === 'object') {
    if (value?.price != null && value?.source) {
      return `${value.source} price=${value.price}`;
    }
    const keys = Object.keys(value);
    return keys.length <= 6 ? `{${keys.join(', ')}}` : `{${keys.slice(0, 6).join(', ')}, …}`;
  }
  return String(value);
}

function mapAssetSources(rows = []) {
  return rows.map((row) => ({
    name: row.name,
    category: row.category,
    source: row.priceSource || 'unavailable',
    asOf: row.priceTimestamp ? new Date(row.priceTimestamp).toLocaleString() : '-',
  }));
}

export default function DevelopmentPage({ frontendVersion }) {
  const status = useApiData('/api/dev/status');
  const { portfolio, isLoading: isDashboardLoading, error: dashboardError } = useDashboard();

  const fxCache = status.data?.caches?.fx?.entries || [];
  const marketDataCache = status.data?.caches?.marketData?.entries || [];

  const assetSources = useMemo(
    () => mapAssetSources(portfolio?.tableRows || []),
    [portfolio?.tableRows],
  );

  return (
    <section className="contentWrap">
      <header className="pageHeader">
        <h1>Development</h1>
      </header>

      <div className="dashboardPanel">
        {(status.isLoading || isDashboardLoading) && <p>Loading development diagnostics...</p>}
        {!status.isLoading && status.error && <p className="error">{status.error}</p>}
        {!isDashboardLoading && dashboardError && <p className="error">{dashboardError}</p>}

        {!status.isLoading && !status.error && (
          <article className="tableCard">
            <h2>Version</h2>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Version</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Frontend</td>
                    <td>{frontendVersion || 'unknown'}</td>
                  </tr>
                  <tr>
                    <td>Backend</td>
                    <td>{status.data?.backendVersion || 'unknown'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        )}

        {!status.isLoading && !status.error && (
          <article className="tableCard">
            <h2>3rd Party Fetch Diagnostics</h2>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Status</th>
                    <th>Message</th>
                    <th>Checked At</th>
                  </tr>
                </thead>
                <tbody>
                  {(status.data?.providerDiagnostics || []).map((item) => (
                    <tr key={`${item.provider}-${item.checkedAt}`}>
                      <td>{item.provider}</td>
                      <td>{item.status}</td>
                      <td>{item.message}</td>
                      <td>{item.checkedAt ? new Date(item.checkedAt).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        )}

        {!status.isLoading && !status.error && (
          <article className="tableCard">
            <h2>Data Source</h2>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Storage</th>
                    <th>User Scoped</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{status.data?.storage?.primary || '-'}</td>
                    <td>{String(status.data?.storage?.userScoped || false)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        )}

        {!isDashboardLoading && !dashboardError && (
          <article className="tableCard">
            <h2>Live Asset Price Source</h2>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Category</th>
                    <th>Source</th>
                    <th>As Of</th>
                  </tr>
                </thead>
                <tbody>
                  {assetSources.map((item) => (
                    <tr key={item.name}>
                      <td>{item.name}</td>
                      <td>{item.category}</td>
                      <td>{item.source}</td>
                      <td>{item.asOf}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        )}

        {!status.isLoading && !status.error && (
          <article className="tableCard">
            <h2>Cache Snapshot</h2>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Cache</th>
                    <th>Key</th>
                    <th>TTL Remaining</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {fxCache.map((item) => (
                    <tr key={`fx:${item.key}`}>
                      <td>fx</td>
                      <td>{item.key}</td>
                      <td>{formatMs(item.ttlRemainingMs)}</td>
                      <td>{summarizeCacheValue(item.value)}</td>
                    </tr>
                  ))}
                  {marketDataCache.map((item) => (
                    <tr key={`mkt:${item.key}`}>
                      <td>marketData</td>
                      <td>{item.key}</td>
                      <td>{formatMs(item.ttlRemainingMs)}</td>
                      <td>{summarizeCacheValue(item.value)}</td>
                    </tr>
                  ))}
                  {fxCache.length === 0 && marketDataCache.length === 0 && (
                    <tr>
                      <td colSpan={4}>No cache entries.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        )}
      </div>
    </section>
  );
}
