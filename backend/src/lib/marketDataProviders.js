import { fetchFinnhubDailyCloses, fetchFinnhubQuotes } from './finnhub.js';
import { fetchCoinbaseDailyCloses, fetchCoinbaseProductQuotes } from './crypto.js';

export class MarketDataProvider {
  constructor(name) {
    this.name = name;
  }
  async getQuotes(targets) {
    throw new Error('Not implemented');
  }
  async getDailyCloses({ target, fromDate, toDate }) {
    throw new Error('Not implemented');
  }
}

export class FinnhubProvider extends MarketDataProvider {
  constructor() {
    super('finnhub');
  }
  async getQuotes(targets) {
    if (!process.env.FINNHUB_API_KEY || targets.length === 0) return {};
    const rawQuotes = await fetchFinnhubQuotes(targets.map((t) => t.providerSymbol));
    return targets.reduce((acc, target) => {
      const quote = rawQuotes[target.providerSymbol];
      if (quote) {
        acc[target.assetSymbol] = { ...quote, symbol: target.assetSymbol };
      }
      return acc;
    }, {});
  }
  async getDailyCloses({ target, fromDate, toDate }) {
    return fetchFinnhubDailyCloses({ symbol: target.providerSymbol, fromDate, toDate });
  }
}

export class CoinbaseProvider extends MarketDataProvider {
  constructor() {
    super('coinbase');
  }
  async getQuotes(targets) {
    if (targets.length === 0) return {};
    return fetchCoinbaseProductQuotes(targets);
  }
  async getDailyCloses({ target, fromDate, toDate }) {
    return fetchCoinbaseDailyCloses({ productId: target.providerSymbol, fromDate, toDate });
  }
}

export const stockProviders = {
  finnhub: new FinnhubProvider(),
};

export const cryptoProviders = {
  coinbase: new CoinbaseProvider(),
};
