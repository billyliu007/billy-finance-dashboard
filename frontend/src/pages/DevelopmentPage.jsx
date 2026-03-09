import { useMemo } from 'react';
import useApiData from '../hooks/useApiData.js';

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
  const portfolio = useApiData('/api/dashboard/portfolio');

  const assetSources = useMemo(() => mapAssetSources(portfolio.data?.tableRows || []), [portfolio.data]);

  return (
    <section className="contentWrap">
      <header className="pageHeader">
        <h1>Development</h1>
      </header>

      <div className="dashboardPanel">
        {(status.isLoading || portfolio.isLoading) && <p>Loading development diagnostics...</p>}
        {!status.isLoading && status.error && <p className="error">{status.error}</p>}
        {!portfolio.isLoading && portfolio.error && <p className="error">{portfolio.error}</p>}

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

        {!portfolio.isLoading && !portfolio.error && (
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
      </div>
    </section>
  );
}
