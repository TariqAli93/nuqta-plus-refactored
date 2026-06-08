import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  pickEffectiveId,
  getEffectiveBranchId,
  getEffectiveWarehouseId,
  DEFAULT_BRANCH_NAME,
  DEFAULT_WAREHOUSE_NAME,
} from '../src/services/systemDefaultsService.js';
import { closeDatabase } from '../src/db.js';

// Importing the service pulls in db.js, which opens a connection pool at load.
// The cases below only exercise the explicit/assigned precedence paths, which
// never touch the DB — close the pool afterwards so the test process exits.
after(async () => {
  await closeDatabase().catch(() => {});
});

// ── pure precedence helper ───────────────────────────────────────────────────
test('pickEffectiveId prefers explicit over assigned', () => {
  assert.equal(pickEffectiveId(5, 9), 5);
});

test('pickEffectiveId falls back to assigned when no explicit value', () => {
  assert.equal(pickEffectiveId(null, 9), 9);
  assert.equal(pickEffectiveId(undefined, 9), 9);
  assert.equal(pickEffectiveId(0, 9), 9); // 0 is not a valid id
});

test('pickEffectiveId returns null when neither is set (caller uses default)', () => {
  assert.equal(pickEffectiveId(null, null), null);
  assert.equal(pickEffectiveId(undefined, undefined), null);
});

// ── effective branch resolution (no DB hit on these paths) ───────────────────
test('getEffectiveBranchId returns the explicit branch id', async () => {
  assert.equal(await getEffectiveBranchId({ branchId: 5 }), 5);
});

test('getEffectiveBranchId falls back to the user assignment', async () => {
  assert.equal(
    await getEffectiveBranchId({ actingUser: { assignedBranchId: 9 } }),
    9
  );
});

test('getEffectiveBranchId prefers explicit over assignment', async () => {
  assert.equal(
    await getEffectiveBranchId({ branchId: 5, actingUser: { assignedBranchId: 9 } }),
    5
  );
});

// ── effective warehouse resolution (no DB hit on these paths) ────────────────
test('getEffectiveWarehouseId returns the explicit warehouse id', async () => {
  assert.equal(await getEffectiveWarehouseId({ warehouseId: 3 }), 3);
});

test('getEffectiveWarehouseId falls back to the user assignment', async () => {
  assert.equal(
    await getEffectiveWarehouseId({ actingUser: { assignedWarehouseId: 7 } }),
    7
  );
});

// ── internal default names are stable (used by idempotent find-or-create) ────
test('default branch/warehouse names are defined', () => {
  assert.equal(typeof DEFAULT_BRANCH_NAME, 'string');
  assert.ok(DEFAULT_BRANCH_NAME.length > 0);
  assert.equal(typeof DEFAULT_WAREHOUSE_NAME, 'string');
  assert.ok(DEFAULT_WAREHOUSE_NAME.length > 0);
});
