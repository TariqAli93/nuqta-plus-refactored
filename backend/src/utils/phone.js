/**
 * Phone normalization utilities for customer records.
 *
 * Reuses the messaging-side Iraq normalizer so that "the same phone" stays
 * the same across the messaging queue, the customer table, and lookups.
 * Keeping a thin re-export here means callers in services/controllers don't
 * have to reach across into the notifications package.
 */
export { normalizeIraqPhone, isValidPhone } from '../services/notifications/phone.js';
