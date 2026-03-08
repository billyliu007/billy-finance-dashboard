export function resolveFrontendBuildVersion() {
  const explicitVersion = import.meta.env.VITE_APP_VERSION;
  if (explicitVersion) {
    return String(explicitVersion);
  }

  if (import.meta.env.DEV) {
    return 'dev-local';
  }

  if (typeof document === 'undefined') {
    return '';
  }

  const scriptTag = Array.from(document.querySelectorAll('script[src]'))
    .find((script) => /index-[A-Za-z0-9_-]+\.js$/.test(script.getAttribute('src') || ''));

  const source = scriptTag?.getAttribute('src') || '';
  const match = /index-([A-Za-z0-9_-]+)\.js$/.exec(source);
  return match?.[1] || 'unknown';
}
