/**
 * Product-unit helpers shared across POS, NewSale, return form, inventory
 * stock-in and sale detail views. The frontend keeps its own copy of the
 * "what is the price for this unit?" rules so every screen agrees on the
 * same numbers without making an API round-trip.
 *
 * Definitions
 * -----------
 * Each `product.units[]` row is shaped like:
 *   {
 *     id, name,
 *     conversionFactor,            // how many BASE units are in this unit
 *     isBase, isDefaultSale, isDefaultPurchase,
 *     salePrice, costPrice,        // optional per-unit overrides
 *     barcode, isActive
 *   }
 *
 * Pricing rules
 * -------------
 *   - If `unit.salePrice` is set, that's the per-unit sale price.
 *   - Otherwise: `product.sellingPrice * unit.conversionFactor` (the base
 *     price scaled to the selected unit).
 *   - Same fallback applies to cost.
 *
 * Stock rules
 * -----------
 *   - Stock is always counted in the BASE unit on the backend.
 *   - `baseQuantity = quantity * unit.conversionFactor`.
 *   - Per-unit availability shown to the cashier:
 *     `floor(baseAvailable / unit.conversionFactor)`.
 */

export const DEFAULT_BASE_UNIT_NAME = 'قطعة';

/** All unit rows for a product, never null. */
export function getProductUnits(product) {
  return Array.isArray(product?.units) ? product.units : [];
}

/** The base unit for a product (factor 1). Falls back to the first unit. */
export function getBaseUnit(product) {
  const units = getProductUnits(product);
  return units.find((u) => u.isBase) || units[0] || null;
}

/**
 * The unit pre-selected when adding a product to a sale: the explicit
 * "default sale" unit, then the base unit, then the first unit, then null
 * (legacy product with no units configured — caller must treat as base).
 */
export function getDefaultSaleUnit(product) {
  const units = getProductUnits(product);
  return (
    units.find((u) => u.isDefaultSale && u.isActive !== false) ||
    units.find((u) => u.isBase) ||
    units[0] ||
    null
  );
}

/** Numeric conversion factor (defaults to 1 for legacy / missing units). */
export function getUnitConversionFactor(unit) {
  const factor = Number(unit?.conversionFactor);
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/** Per-unit sale price (override → base × factor). */
export function getUnitSalePrice(product, unit) {
  if (unit && unit.salePrice != null && unit.salePrice !== '') {
    return Number(unit.salePrice) || 0;
  }
  const base = Number(product?.sellingPrice) || 0;
  return base * getUnitConversionFactor(unit);
}

/** Per-unit cost (override → base × factor). */
export function getUnitCostPrice(product, unit) {
  if (unit && unit.costPrice != null && unit.costPrice !== '') {
    return Number(unit.costPrice) || 0;
  }
  const base = Number(product?.costPrice) || 0;
  return base * getUnitConversionFactor(unit);
}

/** Convert "2 درزن" → "24 قطعة". Always integer. */
export function toBaseQuantity(quantity, unit) {
  return Math.round((Number(quantity) || 0) * getUnitConversionFactor(unit));
}

/**
 * Subtotal of one cart line. ALWAYS quantity * unitPrice (NOT base qty).
 * Discount is per-unit too — the same shape POS / NewSale already use.
 */
export function calculateUnitSubtotal(quantity, unitPrice, discount = 0) {
  const qty = Number(quantity) || 0;
  const price = Number(unitPrice) || 0;
  const disc = Number(discount) || 0;
  return Math.max(0, qty * (price - disc));
}

/**
 * Per-line profit using the cart's selected unit. Used for live POS / NewSale
 * profit previews — the persisted sale_items already store the snapshot, so
 * SaleDetails reads its profit from the backend instead of recomputing here.
 */
export function calculateUnitProfit(quantity, unit, product, discount = 0) {
  const qty = Number(quantity) || 0;
  const revenue = qty * getUnitSalePrice(product, unit) - qty * (Number(discount) || 0);
  const cost = qty * getUnitCostPrice(product, unit);
  return revenue - cost;
}

/**
 * Per-unit available stock (e.g. "كم درزن متبقي?"). The backend always
 * exposes stock in base units; this is the integer floor in the chosen unit.
 */
export function getUnitAvailableStock(baseAvailable, unit) {
  const base = Number(baseAvailable) || 0;
  const factor = getUnitConversionFactor(unit);
  if (factor <= 0) return base;
  return Math.floor(base / factor);
}

/**
 * Format a quantity + unit pair the way invoices and cart lines should
 * read it: "2 درزن" rather than "2 (24 قطعة)".
 */
export function formatQuantityWithUnit(quantity, unitName) {
  const qty = Number(quantity) || 0;
  if (!unitName) return String(qty);
  return `${qty} ${unitName}`;
}
