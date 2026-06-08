import { test } from 'node:test';
import assert from 'node:assert/strict';

import { netAfterReturn, returnedItemCost } from '../src/services/reportMath.js';

// ── netAfterReturn ───────────────────────────────────────────────────────────
test('netAfterReturn subtracts the returned amount', () => {
  assert.equal(netAfterReturn(150, 60), 90);
});

test('netAfterReturn nets a full return back to zero', () => {
  assert.equal(netAfterReturn(150, 150), 0);
});

test('netAfterReturn never goes negative (over-refund safety)', () => {
  assert.equal(netAfterReturn(100, 130), 0);
});

test('netAfterReturn handles no returns', () => {
  assert.equal(netAfterReturn(150, 0), 150);
  assert.equal(netAfterReturn(150, undefined), 150);
});

// ── returnedItemCost ─────────────────────────────────────────────────────────
test('returnedItemCost uses the per-unit snapshot when present', () => {
  // 2 returned units × snapshot cost 10 = 20 (base quantity is ignored when a
  // per-selected-unit snapshot exists)
  assert.equal(
    returnedItemCost({ quantity: 2, baseQuantity: 24, unitConversionFactor: 12, unitCostPrice: '10', productCost: '7' }),
    20
  );
});

test('returnedItemCost falls back to product base cost × base quantity', () => {
  // no snapshot → 2 units × factor 12 = 24 base × base cost 7 = 168
  assert.equal(
    returnedItemCost({ quantity: 2, baseQuantity: 24, unitConversionFactor: 12, unitCostPrice: null, productCost: '7' }),
    168
  );
});

test('returnedItemCost derives base quantity from factor when not stored', () => {
  assert.equal(
    returnedItemCost({ quantity: 3, baseQuantity: 0, unitConversionFactor: 4, unitCostPrice: null, productCost: '5' }),
    60 // 3 × 4 = 12 base × 5
  );
});

test('returnedItemCost is zero for a zero/empty return', () => {
  assert.equal(returnedItemCost({ quantity: 0, productCost: '10' }), 0);
  assert.equal(returnedItemCost({}), 0);
});

// ── End-to-end-ish: prove returned profit nets to the original margin ─────────
test('full single-line return nets revenue, cost and profit to zero', () => {
  const grossRevenue = 150; // 5 × 30
  const grossCost = 50; // 5 × 10 (base cost, no snapshot)
  const returnedValue = 150; // full return
  const returnedCost = returnedItemCost({
    quantity: 5,
    baseQuantity: 5,
    unitConversionFactor: 1,
    unitCostPrice: null,
    productCost: '10',
  });
  const netRevenue = netAfterReturn(grossRevenue, returnedValue);
  const netCost = netAfterReturn(grossCost, returnedCost);
  assert.equal(netRevenue, 0);
  assert.equal(netCost, 0);
  assert.equal(netRevenue - netCost, 0); // gross profit reversed
});

test('partial return reduces revenue/cost/profit proportionally', () => {
  const grossRevenue = 150; // 5 × 30
  const grossCost = 50; // 5 × 10
  const returnedValue = 60; // 2 × 30
  const returnedCost = returnedItemCost({
    quantity: 2,
    baseQuantity: 2,
    unitConversionFactor: 1,
    unitCostPrice: null,
    productCost: '10',
  });
  const netRevenue = netAfterReturn(grossRevenue, returnedValue);
  const netCost = netAfterReturn(grossCost, returnedCost);
  assert.equal(netRevenue, 90);
  assert.equal(netCost, 30);
  assert.equal(netRevenue - netCost, 60); // gross profit was 100, now 60
});
