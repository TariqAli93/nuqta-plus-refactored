import { createBulkSmsIraqAdapter } from './bulkSmsIraq.js';

/**
 * Provider registry. Add new providers here — the rest of the system never
 * imports a specific adapter, only the abstract interface returned by the
 * factory.
 */
const REGISTRY = {
  bulksmsiraq: createBulkSmsIraqAdapter,
};

export function listProviders() {
  return Object.keys(REGISTRY);
}

/**
 * Build a provider adapter for the given settings row. Returns `null` when
 * the configured provider is unknown or the API key is missing.
 */
export function createAdapter({ provider, apiKey, senderId } = {}) {
  if (!provider || !apiKey) return null;
  const factory = REGISTRY[provider];
  if (!factory) return null;
  try {
    return factory({ apiKey, senderId });
  } catch {
    return null;
  }
}
