export class TtlCache {
  constructor(defaultTtlMs = 60000) {
    this.cache = new Map();
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Return a best-effort snapshot of non-expired entries.
   * Intended for diagnostics only (e.g. /api/dev/status).
   */
  dump({ limit = 200 } = {}) {
    const now = Date.now();
    const entries = [];
    for (const [key, item] of this.cache.entries()) {
      if (!item) continue;
      if (now > item.expiresAt) {
        this.cache.delete(key);
        continue;
      }
      entries.push({
        key,
        expiresAt: item.expiresAt,
        ttlRemainingMs: Math.max(0, item.expiresAt - now),
        value: item.value,
      });
    }
    entries.sort((a, b) => a.ttlRemainingMs - b.ttlRemainingMs);
    return entries.slice(0, Math.max(0, limit));
  }
}

export const marketDataCache = new TtlCache(60000); // 1 minute default
export const fxCache = new TtlCache(3600000); // 1 hour default
