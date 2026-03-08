import { useMemo } from 'react';
import useApiData from '../hooks/useApiData.js';

function mapAssetSources(rows = []) {
  return rows.map((row) => ({
    name: row.name,
    category: row.category,
    source: row.priceSource || 'sheet',
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
            <h2>Configured Data Providers</h2>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Asset Type</th>
                    <th>Primary</th>
                    <th>Fallback</th>
                    <th>Symbols</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Stocks</td>
                    <td>{status.data?.marketData?.stocks?.primary || '-'}</td>
                    <td>{status.data?.marketData?.stocks?.fallback || '-'}</td>
                    <td>{(status.data?.marketData?.stocks?.symbols || []).join(', ') || '-'}</td>
                  </tr>
                  <tr>
                    <td>Crypto</td>
                    <td>{status.data?.marketData?.crypto?.primary || '-'}</td>
                    <td>{status.data?.marketData?.crypto?.fallback || '-'}</td>
                    <td>{(status.data?.marketData?.crypto?.symbols || []).join(', ') || '-'}</td>
                  </tr>
                  <tr>
                    <td>FX</td>
                    <td>{status.data?.marketData?.fx?.primary || '-'}</td>
                    <td>{status.data?.marketData?.fx?.fallback || '-'}</td>
                    <td>{(status.data?.marketData?.fx?.pairs || []).join(', ') || '-'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        )}

        {!status.isLoading && !status.error && (
          <article className="tableCard">
            <h2>Other Sheet-Backed Data</h2>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Dataset</th>
                    <th>Sheet Range</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(status.data?.sheetBackedData || []).map((item) => (
                    <tr key={item.key}>
                      <td>{item.label}</td>
                      <td>{item.range}</td>
                      <td>{item.notes}</td>
                    </tr>
                  ))}
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
