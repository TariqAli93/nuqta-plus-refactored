/**
 * Sale source / type / payment-method enums.
 * Mirror of backend/src/constants/sales.js — keep the two in sync.
 *
 * Business rules encoded here:
 *   - POS screen: direct sales only, cash or card, no deferred balance.
 *   - NewSale screen: installment sales only (cash down payment is the
 *     first installment, not a separate flow).
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

/** Methods allowed at the POS. Anything else must be rejected. */
export const POS_PAYMENT_METHODS = Object.freeze([PAYMENT_METHOD_CASH, PAYMENT_METHOD_CARD]);

/** Superset of methods the system knows about. */
export const ALL_PAYMENT_METHODS = Object.freeze([PAYMENT_METHOD_CASH, PAYMENT_METHOD_CARD]);

// ── Rules ──────────────────────────────────────────────────────────────────
/** Card payments must carry a non-empty reference number. */
export const isCardMethod = (method) => method === PAYMENT_METHOD_CARD;

/** POS sales must be CASH saleType. */
export const isPosSource = (source) => source === SALE_SOURCE_POS;
export const isNewSaleSource = (source) => source === SALE_SOURCE_NEW_SALE;
