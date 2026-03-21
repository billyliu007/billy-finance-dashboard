/**
 * Stable aggregate import path for finance DB access.
 * Implementation lives in domain modules; import those directly in new code when convenient.
 */
export * from './currencyRepository.js';
export * from './cashRepository.js';
export * from './netWorthHistoryRepository.js';
export * from './marketReferenceRepository.js';
export * from './portfolioRepository.js';
