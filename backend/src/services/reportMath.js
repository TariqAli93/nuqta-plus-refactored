/**
 * Pure report math shared by the sales/profit/product reports so the
 * "net out returns" logic lives in exactly one place (and is unit-testable
 * without a database).
 *
 * Accounting model: a returned / partially-returned sale keeps its original
 * `sales.total` and `sale_items` rows; the refunded portion is recorded in
 * `sale_returns` (authoritative, capped `returnedValue`) and `sale_return_items`
 * (per-line quantities). Every gross revenue/COGS/quantity figure must therefore
 * have the returned portion subtracted to reflect the *net* sale.
 */

/** Subtract a returned amount from a gross figure, never going below zero. */
export function netAfterReturn(gross, returned) {
  return Math.max(0, (Number(gross) || 0) - (Number(returned) || 0));
}

/**
 * Cost of a returned line, using the SAME per-unit basis the forward profit
 * uses so a full return nets the line's profit back to zero:
 *   - prefer the sale-time snapshot `unitCostPrice` (per selected unit) × qty;
 *   - otherwise fall back to the product's base cost × base quantity.
 *
 * @param {{quantity, baseQuantity, unitConversionFactor, unitCostPrice, productCost}} line
 */
export function returnedItemCost({
  quantity,
  baseQuantity,
  unitConversionFactor,
  unitCostPrice,
  productCost,
} = {}) {
  const qty = Number(quantity) || 0;
  if (qty <= 0) return 0;
  const factor = Number(unitConversionFactor) || 1;
  const baseQty = Number(baseQuantity) || qty * factor;
  const unitCost =
    unitCostPrice === null || unitCostPrice === undefined || unitCostPrice === ''
      ? null
      : Number(unitCostPrice);
  const baseCost = Number(productCost) || 0;
  return unitCost != null ? unitCost * qty : baseCost * baseQty;
}

export default { netAfterReturn, returnedItemCost };
