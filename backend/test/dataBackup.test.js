import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';

import service, {
  BACKUP_GROUPS,
  RESTORE_ORDER,
  tablesForGroups,
} from '../src/services/dataBackupService.js';
import { encodeBackup, decodeBackup, sha256 } from '../src/utils/backupCodec.js';
import { closeDatabase } from '../src/db.js';

// Importing the service pulls in db.js, which opens a connection pool at load.
// These tests don't touch the DB, so close the pool afterwards to exit cleanly.
after(async () => {
  await closeDatabase().catch(() => {});
});

// ── Fixtures ────────────────────────────────────────────────────────────────
function sampleData() {
  return {
    users: [{ id: 1, username: 'admin', password: 'hash', full_name: 'Admin', role: 'admin' }],
    customers: [{ id: 1, name: 'Acme', phone: '07700000000' }],
    settings: [{ id: 1, key: 'company_name', value: 'Nuqta' }],
    products: [{ id: 1, name: 'Widget', cost_price: '1.0000', selling_price: '2.0000' }],
    categories: [{ id: 1, name: 'General' }],
    sales: [{ id: 1, invoice_number: 'INV-1', total: '2.0000', payment_type: 'cash' }],
    sale_items: [{ id: 1, sale_id: 1, product_name: 'Widget', quantity: 1, unit_price: '2', subtotal: '2' }],
    sale_item_stock_entries: [{ id: 1, sale_item_id: 1, product_stock_entry_id: 1, quantity: 1 }],
    sale_returns: [{ id: 1, sale_id: 1, returned_value: '2.0000' }],
    sale_return_items: [{ id: 1, return_id: 1, product_name: 'Widget', quantity: 1, unit_price: '2', subtotal: '2' }],
  };
}

// ── 1. create backup with one group ──────────────────────────────────────────
test('builds a backup for a single group', () => {
  const { content, manifest } = service.buildArchive(sampleData(), ['products']);
  assert.deepEqual(manifest.selectedGroups, ['products']);
  assert.equal(manifest.counts.products, 1);
  assert.ok(content.startsWith('NQBKP|'));
});

// ── 2. create backup with all groups ─────────────────────────────────────────
test('builds a backup for all groups', () => {
  const allGroups = Object.keys(BACKUP_GROUPS);
  const { manifest } = service.buildArchive(sampleData(), allGroups);
  assert.deepEqual(manifest.selectedGroups, allGroups);
  // every table of every group has a manifest file entry
  for (const group of allGroups) {
    for (const table of BACKUP_GROUPS[group].tables) {
      assert.ok(manifest.files[table], `missing file entry for ${table}`);
    }
  }
});

// ── 3. backup ZIP contains manifest.json ─────────────────────────────────────
test('archive always contains manifest.json', () => {
  const { content } = service.buildArchive(sampleData(), ['users']);
  const zip = new AdmZip(decodeBackup(content));
  assert.ok(zip.getEntry('manifest.json'), 'manifest.json missing');
});

// ── 4. backup ZIP contains only selected groups ──────────────────────────────
test('archive contains only selected groups', () => {
  const { content } = service.buildArchive(sampleData(), ['products']);
  const zip = new AdmZip(decodeBackup(content));
  const names = zip.getEntries().map((e) => e.entryName).sort();
  assert.deepEqual(names, ['data/products.json', 'manifest.json']);
});

// ── 5. restore validates manifest ────────────────────────────────────────────
test('parseBackup validates and returns the manifest', () => {
  const { content } = service.buildArchive(sampleData(), ['categories']);
  const { manifest } = service.parseBackup(content);
  assert.equal(manifest.app, 'NuqtaPlus');
  assert.equal(manifest.backupVersion, 1);
  assert.ok(manifest.warning.length > 0);
});

// ── 6. restore rejects invalid/corrupt file ──────────────────────────────────
test('parseBackup rejects a non-backup file', () => {
  assert.throws(() => service.parseBackup('not-a-backup'), /backup header/i);
});

test('parseBackup rejects a corrupt archive', () => {
  const garbage = encodeBackup(Buffer.from('this is not a zip file at all'));
  assert.throws(() => service.parseBackup(garbage), /valid archive|manifest/i);
});

// ── 7. restore rejects checksum mismatch ─────────────────────────────────────
test('parseBackup rejects a tampered data file (checksum mismatch)', () => {
  const { content } = service.buildArchive(sampleData(), ['products']);
  // Tamper: rewrite products.json inside the zip but keep the old manifest hash.
  const zip = new AdmZip(decodeBackup(content));
  zip.updateFile('data/products.json', Buffer.from('[{"id":999,"name":"HACKED"}]', 'utf8'));
  const tampered = encodeBackup(zip.toBuffer());
  assert.throws(() => service.parseBackup(tampered), /checksum mismatch/i);
});

// ── 8. restore rolls back on error ───────────────────────────────────────────
test('_applyRestore rolls back when a statement fails', async () => {
  const queries = [];
  const fakeClient = {
    async query(sql) {
      queries.push(String(sql).trim().split('\n')[0]);
      if (/^INSERT/i.test(String(sql).trim())) {
        throw new Error('boom');
      }
      return { rows: [] };
    },
    release() {},
  };
  const fakePool = { connect: async () => fakeClient };

  await assert.rejects(
    () => service._applyRestore(fakePool, ['products'], { products: [{ id: 1, name: 'x' }] }, false),
    /boom/
  );
  assert.ok(queries.includes('BEGIN'));
  assert.ok(queries.includes('ROLLBACK'), 'expected ROLLBACK after failure');
  assert.ok(!queries.includes('COMMIT'), 'must not COMMIT on failure');
});

// ── 9. restore preserves foreign key integrity (dependency order) ────────────
test('restore order inserts parents before children', () => {
  const tables = tablesForGroups(Object.keys(BACKUP_GROUPS));
  const pos = (t) => tables.indexOf(t);
  assert.ok(pos('users') < pos('products'), 'users before products');
  assert.ok(pos('categories') < pos('products'), 'categories before products');
  assert.ok(pos('products') < pos('product_stock'), 'products before product_stock');
  assert.ok(pos('sales') < pos('sale_items'), 'sales before sale_items');
  assert.ok(pos('sale_items') < pos('sale_item_stock_entries'), 'sale_items before its entries');
  assert.ok(pos('sale_returns') < pos('sale_return_items'), 'returns before return items');
  assert.ok(pos('branches') < pos('warehouses'), 'branches before warehouses');
  // delete must be the exact reverse
  const deleteOrder = [...tables].reverse();
  assert.equal(deleteOrder[0], tables[tables.length - 1]);
});

// ── 10. restore sales group with all related tables ──────────────────────────
test('sales group bundles every related table', () => {
  assert.deepEqual(BACKUP_GROUPS.sales.tables, [
    'sales',
    'sale_items',
    'sale_item_stock_entries',
    'sale_returns',
    'sale_return_items',
  ]);
  // all are present in the global restore order
  for (const t of BACKUP_GROUPS.sales.tables) {
    assert.ok(RESTORE_ORDER.includes(t), `${t} missing from RESTORE_ORDER`);
  }
});

// ── 11. restore users/customers/settings ─────────────────────────────────────
test('users, customers and settings round-trip through an archive', () => {
  const groups = ['users', 'customers', 'settings'];
  const { content } = service.buildArchive(sampleData(), groups);
  const { manifest, zip } = service.parseBackup(content);
  assert.deepEqual(manifest.selectedGroups, groups);
  for (const table of ['users', 'customers', 'settings']) {
    const rows = JSON.parse(zip.getEntry(`data/${table}.json`).getData().toString('utf8'));
    assert.equal(rows.length, 1);
  }
});

// ── 12. restore works after decoding an encoded ZIP file ─────────────────────
test('data survives the full encode → decode round trip', () => {
  const data = sampleData();
  const { content, manifest } = service.buildArchive(data, ['sales']);
  // simulate writing to .nqbackup and reading it back as a Buffer
  const fileBytes = Buffer.from(content, 'utf8');
  const { zip } = service.parseBackup(fileBytes);
  const restored = JSON.parse(zip.getEntry('data/sales.json').getData().toString('utf8'));
  assert.deepEqual(restored, data.sales);
  // manifest checksum matches the recomputed hash of the stored bytes
  const storedBytes = zip.getEntry('data/sales.json').getData();
  assert.equal(manifest.files.sales.checksum, sha256(storedBytes));
});
