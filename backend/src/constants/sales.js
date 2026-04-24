/**
 * Sale source / type / payment-method enums.
 * Mirror of frontend/src/constants/sales.js — keep the two in sync.
 *
 * Business rules encoded here:
 *   - POS screen: direct sales only, cash or card, no deferred balance.
 *   - NewSale screen: installment sales only.
 */

// ── Sale source ────────────────────────────────────────────────────────────
export const SALE_SOURCE_POS = 'POS';
export const SALE_SOURCE_NEW_SALE = 'NEW_SALE';
export const SALE_SOURCES = Object.freeze([SALE_SOURCE_POS, SALE_SOURCE_NEW_SALE]);

// ── Sale type ──────────────────────────────────────────────────────────────
export const SALE_TYPE_CASH = 'CASH';
export const SALE_TYPE_INSTALLMENT = 'INSTALLMENT';
export const SALE_TYPES = Object.freeze([SALE_TYPE_CASH, SALE_TYPE_INSTALLMENT]);

// ── Payment method ─────────────────────────────────────────────────────────
export const PAYMENT_METHOD_CASH = 'cash';
export const PAYMENT_METHOD_CARD = 'card';
export const POS_PAYMENT_METHODS = Object.freeze([PAYMENT_METHOD_CASH, PAYMENT_METHOD_CARD]);
export const ALL_PAYMENT_METHODS = Object.freeze([PAYMENT_METHOD_CASH, PAYMENT_METHOD_CARD]);

/**
 * Map frontend saleType → legacy `paymentType` column on the sales table.
 * Existing column only knows 'cash' | 'installment' | 'mixed'; we keep
 * using it so the DB schema stays unchanged.
 */
export const saleTypeToPaymentType = (saleType) =>
  saleType === SALE_TYPE_INSTALLMENT ? 'installment' : 'cash';

export const isCardMethod = (method) => method === PAYMENT_METHOD_CARD;
export const isPosSource = (source) => source === SALE_SOURCE_POS;
export const isNewSaleSource = (source) => source === SALE_SOURCE_NEW_SALE;
