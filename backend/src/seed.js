/**
 * Iraqi market deterministic seed.
 *
 * Goal: rebuild the demo database into a realistic, fully-connected Iraqi
 * market scenario. Every monetary amount is in Iraqi dinar (IQD). Every
 * scenario is internally consistent — sale totals match line items, payment
 * sums match `paid_amount`, installments match the installment plan, and
 * stock movements match the actual stock decreases/increases.
 *
 * The seed is idempotent. It uses find-or-create patterns keyed on natural
 * unique columns (username, name, sku, invoice_number, …) so re-running
 * without `--reset` does not create duplicates.
 *
 * CLI flags:
 *   --reset   Truncate demo tables in dependency order and re-seed everything.
 *   --demo    Seed the rich demo scenarios (sales / payments / installments /
 *             returns / cash sessions / expenses / notifications / transfers).
 *             Implied by --reset.
 *
 * Schema notes:
 *   - sales.status ∈ {pending, completed, cancelled, draft} (CHECK constraint).
 *     'active' is NOT a valid value — installment sales with a balance use
 *     'pending' until fully paid.
 *   - sales.payment_type ∈ {cash, installment, mixed}.
 *   - sales.issued_at must be NOT NULL when status <> 'draft'. The seed sets
 *     it explicitly because the `sales_protect_finalized_invoice_trigger`
 *     locks invoice_number / issued_at / branch_id once issued_at is non-null.
 *   - All amount columns are non-negative (CHECK constraints).
 */

import { getDb, getPool, closeDatabase } from './db.js';
import {
  users,
  customers,
  categories,
  products,
  productUnits,
  sales,
  saleItems,
  payments,
  installments,
  currencySettings,
  settings,
  branches,
  warehouses,
  productStock,
  stockMovements,
  warehouseTransfers,
  cashSessions,
  saleReturns,
  saleReturnItems,
  expenses,
  installmentActions,
  notificationSettings,
  notifications,
  auditLog,
} from './models/index.js';
import { hashPassword } from './utils/helpers.js';
import { normalizeIraqPhone } from './utils/phone.js';
import { and, eq, sql } from 'drizzle-orm';

// ── CLI flags ─────────────────────────────────────────────────────────────
const ARGS = new Set(process.argv.slice(2));
const HAS_FLAG = (...names) => names.some((n) => ARGS.has(n));
const MODE_RESET = HAS_FLAG('--reset');
const MODE_DEMO = HAS_FLAG('--demo') || MODE_RESET;

// ── Environment protection ────────────────────────────────────────────────
const NODE_ENV = process.env.NODE_ENV || 'development';
const SEED_CONFIRM = process.env.SEED_CONFIRM === 'true';

function assertEnvironment() {
  if (NODE_ENV === 'production' && !SEED_CONFIRM) {
    console.error('[seed] refusing to run in production without SEED_CONFIRM=true');
    process.exit(1);
  }
  if (MODE_RESET && NODE_ENV === 'production' && !SEED_CONFIRM) {
    console.error('[seed] reset blocked in production. Set SEED_CONFIRM=true to override.');
    process.exit(1);
  }
}

// ── Logger ────────────────────────────────────────────────────────────────
const log = {
  info: (msg) => console.log(`[seed] ${msg}`),
  ok: (msg) => console.log(`[seed]   ✓ ${msg}`),
  skip: (msg) => console.log(`[seed]   - ${msg}`),
  warn: (msg) => console.warn(`[seed]   ! ${msg}`),
  err: (msg) => console.error(`[seed] ✗ ${msg}`),
};

// ── Currency / number helpers ─────────────────────────────────────────────
// All financial columns are numeric(18,4). Format consistently with 4 decimals.
const D = (n) => String(Number(n).toFixed(4));
const IQD = 'IQD';

// ── Date helpers ──────────────────────────────────────────────────────────
const dateAt = (year, month, day, hour = 12, minute = 0) =>
  new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
const addDays = (d, days) => {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
};
const fmtDate = (d) => d.toISOString().slice(0, 10);

// Anchor the seed to a fixed "today" so the relative dates are deterministic.
// All sales fall in the last ~6 months relative to this anchor; overdue
// installments sit before it, upcoming installments sit after it.
const TODAY = dateAt(2026, 4, 30);

// ── Find-or-create / upsert helpers ───────────────────────────────────────
async function findOne(db, table, whereExpr) {
  const rows = await db.select().from(table).where(whereExpr).limit(1);
  return rows[0] || null;
}

// ── Domain seed: foundation ───────────────────────────────────────────────
async function seedCurrencies(db) {
  // IQD is the base currency for the entire demo. USD is kept as a
  // reference rate for any future exchange-rate UI but no transaction in
  // this seed uses USD.
  const data = [
    { currencyCode: 'IQD', currencyName: 'دينار عراقي', symbol: 'د.ع', exchangeRate: '1', isBaseCurrency: true, isActive: true },
    { currencyCode: 'USD', currencyName: 'دولار أمريكي', symbol: '$', exchangeRate: '0.000690', isBaseCurrency: false, isActive: true },
  ];
  let inserted = 0;
  let updated = 0;
  for (const row of data) {
    const existing = await findOne(db, currencySettings, eq(currencySettings.currencyCode, row.currencyCode));
    if (existing) {
      // Make sure IQD is flagged as the base currency even if a previous
      // seed set USD as base.
      if (
        existing.isBaseCurrency !== row.isBaseCurrency ||
        existing.exchangeRate !== row.exchangeRate
      ) {
        await db
          .update(currencySettings)
          .set({ isBaseCurrency: row.isBaseCurrency, exchangeRate: row.exchangeRate })
          .where(eq(currencySettings.id, existing.id));
        updated++;
      }
      continue;
    }
    await db.insert(currencySettings).values(row);
    inserted++;
  }
  log.ok(`currencies (${inserted} new, ${updated} updated)`);
}

async function seedSettings(db) {
  const rows = [
    { key: 'currency.default', value: 'IQD', description: 'العملة الافتراضية للنظام' },
    {
      key: 'feature_flags',
      value: JSON.stringify({
        installments: true,
        creditScore: true,
        inventory: true,
        pos: true,
        draftInvoices: true,
        multiBranch: true,
        multiWarehouse: true,
        warehouseTransfers: true,
        alerts: true,
        liveOperations: true,
        expenses: true,
        notifications: true,
      }),
      description: 'Feature toggles for optional product modules',
    },
    { key: 'company.name', value: 'نقطة بلس - متجر الديوانية', description: 'اسم الشركة' },
    { key: 'company.address', value: 'بغداد - الكرادة', description: 'عنوان الشركة' },
    { key: 'company.phone', value: '07700000000', description: 'هاتف الشركة' },
  ];
  let inserted = 0;
  for (const row of rows) {
    const existing = await findOne(db, settings, eq(settings.key, row.key));
    if (existing) continue;
    await db.insert(settings).values(row);
    inserted++;
  }
  log.ok(`settings (${inserted} new)`);
}

async function seedUsers(db) {
  // Safe development passwords. Never used by anything other than the demo
  // database. Keep `Passw0rd!` consistent with the legacy seed so anyone
  // following older docs can still log in.
  const password = await hashPassword('Passw0rd!');
  const adminPassword = await hashPassword('Admin@123');

  // The permission matrix defines: global_admin, admin, branch_admin,
  // branch_manager, manager, cashier, viewer. There is no dedicated
  // "accountant" role — we map it to `manager` (full read + financial UI),
  // and "sales employee" maps to `cashier`.
  const definitions = [
    { username: 'admin', fullName: 'مدير النظام', role: 'admin', phone: '07700000001', password: adminPassword },
    { username: 'global.admin', fullName: 'مدير عام', role: 'global_admin', phone: '07700000002', password },
    { username: 'branch.admin.karada', fullName: 'مدير فرع الكرادة', role: 'branch_admin', phone: '07700000003', password },
    { username: 'branch.manager.karada', fullName: 'مشرف فرع الكرادة', role: 'branch_manager', phone: '07700000004', password },
    { username: 'cashier.karada', fullName: 'كاشير الكرادة', role: 'cashier', phone: '07700000005', password },
    { username: 'sales.karada', fullName: 'مندوب مبيعات الكرادة', role: 'cashier', phone: '07700000006', password },
    { username: 'accountant', fullName: 'محاسب', role: 'manager', phone: '07700000007', password },
    { username: 'cashier.basra', fullName: 'كاشير البصرة', role: 'cashier', phone: '07700000008', password },
    { username: 'cashier.najaf', fullName: 'كاشير النجف', role: 'cashier', phone: '07700000009', password },
    { username: 'viewer', fullName: 'مستخدم قراءة فقط', role: 'viewer', phone: '07700000010', password },
  ];

  const result = {};
  let inserted = 0;
  for (const def of definitions) {
    const existing = await findOne(db, users, eq(users.username, def.username));
    if (existing) {
      result[def.username] = existing;
      continue;
    }
    const [row] = await db
      .insert(users)
      .values({
        username: def.username,
        password: def.password,
        fullName: def.fullName,
        role: def.role,
        phone: def.phone,
        isActive: true,
      })
      .returning();
    result[def.username] = row;
    inserted++;
  }
  log.ok(`users (${inserted} new)`);
  return result;
}

async function seedBranches(db) {
  const defs = [
    { name: 'بغداد - الكرادة', address: 'بغداد - الكرادة - شارع 62' },
    { name: 'بغداد - المنصور', address: 'بغداد - المنصور - حي الأطباء' },
    { name: 'البصرة - العشار', address: 'البصرة - العشار - شارع الكورنيش' },
    { name: 'النجف', address: 'النجف الأشرف - شارع الكوفة' },
  ];
  const result = {};
  let inserted = 0;
  for (const def of defs) {
    const existing = await findOne(db, branches, eq(branches.name, def.name));
    if (existing) {
      result[def.name] = existing;
      continue;
    }
    const [row] = await db
      .insert(branches)
      .values({ name: def.name, address: def.address, isActive: true })
      .returning();
    result[def.name] = row;
    inserted++;
  }
  log.ok(`branches (${inserted} new)`);
  return result;
}

async function seedWarehouses(db, branchMap) {
  const defs = [
    // Karada is the head office: one main warehouse + one accessories side
    // warehouse so warehouse transfers have somewhere realistic to go.
    { name: 'مخزن الكرادة الرئيسي', branch: 'بغداد - الكرادة', isDefault: true },
    { name: 'مخزن الكرادة - الإكسسوارات', branch: 'بغداد - الكرادة', isDefault: false },
    { name: 'مخزن المنصور', branch: 'بغداد - المنصور', isDefault: true },
    { name: 'مخزن البصرة', branch: 'البصرة - العشار', isDefault: true },
    { name: 'مخزن النجف', branch: 'النجف', isDefault: true },
  ];
  const result = {};
  let inserted = 0;
  for (const def of defs) {
    const branch = branchMap[def.branch];
    if (!branch) continue;
    const existing = (await db
      .select()
      .from(warehouses)
      .where(eq(warehouses.name, def.name))
      .limit(1))[0];
    let row = existing;
    if (!row) {
      [row] = await db
        .insert(warehouses)
        .values({ name: def.name, branchId: branch.id, isActive: true })
        .returning();
      inserted++;
    }
    result[def.name] = row;
    if (def.isDefault && branch.defaultWarehouseId !== row.id) {
      await db.update(branches).set({ defaultWarehouseId: row.id }).where(eq(branches.id, branch.id));
      branchMap[def.branch] = { ...branch, defaultWarehouseId: row.id };
    }
  }
  log.ok(`warehouses (${inserted} new)`);
  return result;
}

async function bindUsersToScopes(db, userMap, branchMap, warehouseMap) {
  const karada = branchMap['بغداد - الكرادة'];
  const karadaWh = warehouseMap['مخزن الكرادة الرئيسي'];
  const basra = branchMap['البصرة - العشار'];
  const basraWh = warehouseMap['مخزن البصرة'];
  const najaf = branchMap['النجف'];
  const najafWh = warehouseMap['مخزن النجف'];

  const updates = [
    // Global admin & legacy admin stay unscoped.
    { user: 'branch.admin.karada', branchId: karada?.id, warehouseId: null },
    { user: 'branch.manager.karada', branchId: karada?.id, warehouseId: null },
    { user: 'cashier.karada', branchId: karada?.id, warehouseId: karadaWh?.id },
    { user: 'sales.karada', branchId: karada?.id, warehouseId: karadaWh?.id },
    { user: 'accountant', branchId: karada?.id, warehouseId: null },
    { user: 'cashier.basra', branchId: basra?.id, warehouseId: basraWh?.id },
    { user: 'cashier.najaf', branchId: najaf?.id, warehouseId: najafWh?.id },
    { user: 'viewer', branchId: karada?.id, warehouseId: karadaWh?.id },
  ];
  for (const u of updates) {
    const existing = userMap[u.user];
    if (!existing) continue;
    if (
      existing.assignedBranchId === u.branchId &&
      existing.assignedWarehouseId === u.warehouseId
    ) {
      continue;
    }
    await db
      .update(users)
      .set({ assignedBranchId: u.branchId, assignedWarehouseId: u.warehouseId })
      .where(eq(users.id, existing.id));
    userMap[u.user] = { ...existing, assignedBranchId: u.branchId, assignedWarehouseId: u.warehouseId };
  }
  log.ok('user scope bindings');
}

async function seedCategories(db, adminId) {
  const defs = [
    { name: 'موبايلات', description: 'هواتف ذكية حديثة' },
    { name: 'لابتوبات', description: 'حواسيب محمولة للأعمال والألعاب' },
    { name: 'شاشات', description: 'شاشات للحاسوب والتلفزيون' },
    { name: 'اكسسوارات', description: 'شواحن، كيبلات، سماعات، حماية' },
    { name: 'أجهزة كهربائية', description: 'راوترات، UPS، أجهزة شبكية' },
    { name: 'أدوات منزلية', description: 'مستلزمات منزلية متنوعة' },
    { name: 'قطع غيار / ملحقات', description: 'قطع غيار وملحقات إضافية' },
  ];
  const result = {};
  let inserted = 0;
  for (const def of defs) {
    const existing = await findOne(db, categories, eq(categories.name, def.name));
    if (existing) {
      result[def.name] = existing;
      continue;
    }
    const [row] = await db
      .insert(categories)
      .values({
        name: def.name,
        description: def.description,
        isActive: true,
        createdBy: adminId,
      })
      .returning();
    result[def.name] = row;
    inserted++;
  }
  log.ok(`categories (${inserted} new)`);
  return result;
}

// Realistic Iraqi market prices, all in IQD.
//   Phones:       150,000 → 1,800,000
//   Accessories:    5,000 →    80,000
//   Laptops:      350,000 → 2,500,000
//   Screens:      350,000 → 2,500,000
const PRODUCT_DEFS = [
  { sku: 'PHN-IPH13',   name: 'iPhone 13',                cat: 'موبايلات',         cost: 1_000_000, price: 1_250_000, profile: 'normal' },
  { sku: 'PHN-IPH14P',  name: 'iPhone 14 Pro',            cat: 'موبايلات',         cost: 1_400_000, price: 1_750_000, profile: 'low' },
  { sku: 'PHN-SAMA54',  name: 'Samsung Galaxy A54',       cat: 'موبايلات',         cost:   320_000, price:   425_000, profile: 'normal' },
  { sku: 'PHN-SAMA24',  name: 'Samsung Galaxy A24',       cat: 'موبايلات',         cost:   200_000, price:   275_000, profile: 'normal' },
  { sku: 'PHN-RDMN12',  name: 'Redmi Note 12',            cat: 'موبايلات',         cost:   230_000, price:   310_000, profile: 'normal' },
  { sku: 'PHN-TECNO',   name: 'Tecno Spark',              cat: 'موبايلات',         cost:   130_000, price:   175_000, profile: 'normal' },
  { sku: 'PHN-INFNX',   name: 'Infinix Hot',              cat: 'موبايلات',         cost:   145_000, price:   195_000, profile: 'low' },
  { sku: 'ACC-AIRPDS',  name: 'AirPods (متجر)',           cat: 'اكسسوارات',         cost:    55_000, price:    85_000, profile: 'normal' },
  { sku: 'ACC-CHRTC',   name: 'شاحن Type-C 25W',          cat: 'اكسسوارات',         cost:     5_000, price:    12_000, profile: 'normal' },
  { sku: 'ACC-CBLTC',   name: 'كيبل Type-C',              cat: 'اكسسوارات',         cost:     3_000, price:     7_500, profile: 'normal' },
  { sku: 'ACC-BTHEAD',  name: 'سماعات بلوتوث',            cat: 'اكسسوارات',         cost:    18_000, price:    35_000, profile: 'normal' },
  { sku: 'ACC-PWRBNK',  name: 'باور بانك 20000mAh',       cat: 'اكسسوارات',         cost:    18_000, price:    30_000, profile: 'normal' },
  { sku: 'ACC-CASEIP',  name: 'كفر حماية للهاتف',         cat: 'اكسسوارات',         cost:     1_500, price:     5_000, profile: 'normal' },
  { sku: 'ACC-GLASS',   name: 'زجاج حماية',               cat: 'اكسسوارات',         cost:     1_000, price:     4_000, profile: 'normal' },
  { sku: 'SCR-SAM32',   name: 'شاشة Samsung 32 inch',     cat: 'شاشات',             cost:   280_000, price:   375_000, profile: 'low' },
  { sku: 'LPT-LNVTPD',  name: 'لابتوب Lenovo ThinkPad',   cat: 'لابتوبات',          cost: 1_400_000, price: 1_800_000, profile: 'low' },
  { sku: 'LPT-HPPRO',   name: 'لابتوب HP ProBook',        cat: 'لابتوبات',          cost: 1_100_000, price: 1_450_000, profile: 'normal' },
  { sku: 'NET-UPS',     name: 'UPS منزلي',                cat: 'أجهزة كهربائية',   cost:    75_000, price:   110_000, profile: 'normal' },
  { sku: 'NET-RTRTP',   name: 'راوتر TP-Link',            cat: 'أجهزة كهربائية',   cost:    35_000, price:    55_000, profile: 'zero' },
];

// Realistic Iraqi accessory packaging — pieces inside a dozen (درزن) and a
// carton. Phones / laptops / large items are sold piece-by-piece so they
// only get the base unit.
const PRODUCT_UNIT_DEFS = {
  'ACC-CHRTC':  [ { name: 'درزن', factor: 12 }, { name: 'كارتون', factor: 48 } ],
  'ACC-CBLTC':  [ { name: 'درزن', factor: 12 } ],
  'ACC-CASEIP': [ { name: 'درزن', factor: 12 }, { name: 'كارتون', factor: 100 } ],
  'ACC-GLASS':  [ { name: 'درزن', factor: 12 }, { name: 'كارتون', factor: 100 } ],
  'ACC-PWRBNK': [ { name: 'كارتون', factor: 24 } ],
  'ACC-AIRPDS': [ { name: 'كارتون', factor: 12 } ],
  'ACC-BTHEAD': [ { name: 'كارتون', factor: 12 } ],
};

async function seedProducts(db, catMap, adminId) {
  const result = {};
  let inserted = 0;
  let unitsInserted = 0;
  for (let i = 0; i < PRODUCT_DEFS.length; i++) {
    const def = PRODUCT_DEFS[i];
    const cat = catMap[def.cat];
    const existing = await findOne(db, products, eq(products.sku, def.sku));
    let row = existing;
    if (existing) {
      result[def.sku] = { ...existing, _profile: def.profile };
    } else {
      [row] = await db
        .insert(products)
        .values({
          name: def.name,
          sku: def.sku,
          barcode: String(6_290_000_000_000 + i),
          categoryId: cat?.id || null,
          description: `${def.name} - منتج معتمد للسوق العراقي`,
          costPrice: D(def.cost),
          sellingPrice: D(def.price),
          currency: IQD,
          stock: 0, // populated via distributeStock
          minStock: 3,
          unit: 'piece',
          status: 'available',
          lowStockThreshold: 5,
          isActive: true,
          createdBy: adminId,
        })
        .returning();
      result[def.sku] = { ...row, _profile: def.profile };
      inserted++;
    }

    // Ensure the base unit exists for every product (idempotent).
    const baseExisting = (await db
      .select()
      .from(productUnits)
      .where(and(eq(productUnits.productId, row.id), eq(productUnits.isBase, true)))
      .limit(1))[0];
    if (!baseExisting) {
      await db.insert(productUnits).values({
        productId: row.id,
        name: 'قطعة',
        conversionFactor: '1',
        isBase: true,
        isDefaultSale: true,
        isDefaultPurchase: true,
        isActive: true,
      });
      unitsInserted++;
    }

    // Add packaging units for accessories. Each entry doubles as a small
    // wholesale price hint: per-piece price * factor with a 5–10% discount
    // so wholesale buyers see savings.
    const extraUnits = PRODUCT_UNIT_DEFS[def.sku] || [];
    for (const eu of extraUnits) {
      const dup = (await db
        .select()
        .from(productUnits)
        .where(and(eq(productUnits.productId, row.id), eq(productUnits.name, eu.name)))
        .limit(1))[0];
      if (dup) continue;
      const wholesaleDiscount = eu.factor >= 24 ? 0.92 : 0.95;
      await db.insert(productUnits).values({
        productId: row.id,
        name: eu.name,
        conversionFactor: String(eu.factor),
        isBase: false,
        isDefaultSale: false,
        isDefaultPurchase: false,
        salePrice: D(Math.round(def.price * eu.factor * wholesaleDiscount)),
        costPrice: D(def.cost * eu.factor),
        isActive: true,
      });
      unitsInserted++;
    }
  }
  log.ok(`products (${inserted} new, ${unitsInserted} unit rows)`);
  return result;
}

function quantityForProfile(profile, role) {
  // role: 'primary' (Karada main), 'secondary' (Karada side), 'remote'
  // (Mansour/Basra/Najaf). Profiles: normal / low / zero.
  if (profile === 'zero') return 0;
  if (role === 'primary') return profile === 'low' ? 4 : 25;
  if (role === 'secondary') return profile === 'low' ? 2 : 12;
  /* remote */ return profile === 'low' ? 3 : 15;
}

async function distributeStock(db, productMap, warehouseMap, adminId) {
  const distribution = [
    { warehouse: 'مخزن الكرادة الرئيسي', role: 'primary' },
    { warehouse: 'مخزن الكرادة - الإكسسوارات', role: 'secondary' },
    { warehouse: 'مخزن المنصور', role: 'remote' },
    { warehouse: 'مخزن البصرة', role: 'remote' },
    { warehouse: 'مخزن النجف', role: 'remote' },
  ];

  const skuList = Object.keys(productMap);
  let stockInserts = 0;
  let movementInserts = 0;
  const productTotals = new Map();

  for (const dist of distribution) {
    const wh = warehouseMap[dist.warehouse];
    if (!wh) continue;
    for (const sku of skuList) {
      const product = productMap[sku];
      // Accessories sit primarily in the dedicated accessory warehouse on
      // Karada — primary keeps a smaller buffer so transfers feel realistic.
      let qty = quantityForProfile(product._profile, dist.role);
      if (dist.role === 'secondary' && /^ACC-/.test(sku)) qty = qty * 3;
      if (dist.role === 'primary' && /^ACC-/.test(sku)) qty = Math.max(2, Math.floor(qty / 2));

      const existing = (await db
        .select()
        .from(productStock)
        .where(and(eq(productStock.productId, product.id), eq(productStock.warehouseId, wh.id)))
        .limit(1))[0];

      if (existing) {
        productTotals.set(product.id, (productTotals.get(product.id) || 0) + Number(existing.quantity || 0));
        continue;
      }

      await db.insert(productStock).values({
        productId: product.id,
        warehouseId: wh.id,
        quantity: qty,
      });
      stockInserts++;

      if (qty > 0) {
        await db.insert(stockMovements).values({
          productId: product.id,
          warehouseId: wh.id,
          movementType: 'opening_balance',
          quantityChange: qty,
          quantityBefore: 0,
          quantityAfter: qty,
          referenceType: 'seed',
          referenceId: null,
          notes: 'Opening balance — Iraqi market seed',
          createdBy: adminId,
        });
        movementInserts++;
      }
      productTotals.set(product.id, (productTotals.get(product.id) || 0) + qty);
    }
  }

  for (const [productId, total] of productTotals) {
    await db.update(products).set({ stock: total }).where(eq(products.id, productId));
  }

  log.ok(`product_stock (${stockInserts} new), stock_movements (${movementInserts} new)`);
}

// Iraqi customer profiles. The `profile` field is metadata used later by the
// scenario builder so each customer ends up with a coherent financial story.
//
//   walkin            → anonymous walk-in cash customer
//   good_payer        → completes installments on time, high credit score
//   late_payer        → currently overdue
//   new_customer      → just registered, no installment history
//   high_debt         → multiple active installments outstanding
//   completed         → finished installments cleanly
//   risky             → low credit score (treated as blacklisted in UI)
const CUSTOMER_DEFS = [
  { profile: 'walkin',     name: 'عميل نقدي',                  phone: null,           city: null,         address: null,                     creditScore: null, recommendedLimit: null,    notes: 'الحساب النقدي الافتراضي للبيع المباشر' },
  { profile: 'good_payer', name: 'أحمد علي حسين',              phone: '07701234567', city: 'بغداد',     address: 'بغداد - الكرادة',         creditScore: 88,   recommendedLimit:  3_000_000, notes: 'زبون منتظم وموثوق' },
  { profile: 'completed',  name: 'سارة حسن جواد',              phone: '07811234568', city: 'بغداد',     address: 'بغداد - المنصور',         creditScore: 92,   recommendedLimit:  4_000_000, notes: 'أتمت أقساطها بدون تأخير' },
  { profile: 'good_payer', name: 'محمد رضا الكاظمي',           phone: '07901234569', city: 'النجف',     address: 'النجف - حي السلام',       creditScore: 78,   recommendedLimit:  2_500_000, notes: 'يفضل الأقساط الشهرية' },
  { profile: 'late_payer', name: 'حيدر الجبوري',               phone: '07801234570', city: 'كربلاء',    address: 'كربلاء - باب بغداد',      creditScore: 55,   recommendedLimit:  1_500_000, notes: 'يحتاج متابعة مستمرة' },
  { profile: 'new_customer', name: 'نور الدين العبيدي',         phone: '07911234571', city: 'البصرة',    address: 'البصرة - العشار',         creditScore: null, recommendedLimit:  1_000_000, notes: 'عميل جديد' },
  { profile: 'high_debt',  name: 'مريم العبيدي',               phone: '07951234572', city: 'أربيل',     address: 'أربيل - عينكاوة',         creditScore: 62,   recommendedLimit:  3_500_000, notes: 'لديها أقساط فعالة متعددة' },
  { profile: 'risky',      name: 'عبدالله الشمري',             phone: '07731234573', city: 'الموصل',    address: 'الموصل - الدواسة',         creditScore: 28,   recommendedLimit:    500_000, notes: 'سجل تأخير متكرر — مطلوب موافقة إدارة قبل الأقساط' },
  { profile: 'completed',  name: 'زينب الموسوي',               phone: '07721234574', city: 'السليمانية', address: 'السليمانية - حي الجوادر', creditScore: 85,   recommendedLimit:  2_500_000, notes: 'أنهت أقساطها مبكراً' },
  { profile: 'late_payer', name: 'علي حسين الزبيدي',           phone: '07861234575', city: 'كركوك',     address: 'كركوك - شارع المصلى',     creditScore: 47,   recommendedLimit:  1_200_000, notes: 'تأخر بقسط واحد' },
];

async function seedCustomers(db, adminId) {
  const result = {};
  let inserted = 0;
  for (const def of CUSTOMER_DEFS) {
    const existing = (await db.select().from(customers).where(eq(customers.name, def.name)).limit(1))[0];
    if (existing) {
      result[def.profile] = result[def.profile] || existing;
      result[def.name] = existing;
      continue;
    }
    const normalizedPhone = def.phone ? normalizeIraqPhone(def.phone) : null;
    const [row] = await db
      .insert(customers)
      .values({
        name: def.name,
        phone: def.phone,
        normalizedPhone,
        address: def.address,
        city: def.city,
        notes: def.notes,
        creditScore: def.creditScore,
        creditScoreUpdatedAt: def.creditScore != null ? TODAY : null,
        recommendedLimit: def.recommendedLimit != null ? D(def.recommendedLimit) : null,
        isActive: true,
        createdBy: adminId,
      })
      .returning();
    result[def.profile] = result[def.profile] || row;
    result[def.name] = row;
    inserted++;
  }
  log.ok(`customers (${inserted} new)`);
  return result;
}

// ── Notification settings singleton ───────────────────────────────────────
async function seedNotificationSettings(db) {
  const existing = await findOne(db, notificationSettings, eq(notificationSettings.id, 1));
  if (existing) {
    log.skip('notification settings already initialised');
    return;
  }
  await db
    .insert(notificationSettings)
    .values({
      id: 1,
      // The whole feature stays OFF until an operator wires up an API key.
      // We still want a row so the settings UI loads cleanly.
      enabled: false,
      provider: 'bulksmsiraq',
      smsEnabled: true,
      whatsappEnabled: false,
      autoFallbackEnabled: true,
      defaultChannel: 'auto',
      overdueReminderEnabled: true,
      paymentConfirmationEnabled: true,
      bulkMessagingEnabled: false,
      singleCustomerMessagingEnabled: true,
    })
    .onConflictDoNothing();
  log.ok('notification settings');
}

// ── Sale scenario builder ─────────────────────────────────────────────────
//
// Every scenario describes a fully-consistent invoice in IQD: line items,
// the cash/installment payment plan, and any installment schedule. The
// builder applies them inside a transaction so each insert chain is atomic.
//
// `installments.plan`
//   schedule of {dueDate, amount, status}, where status ∈ {'paid','pending'}
//   — NOT 'active'. The sale's `status` follows: 'completed' if every
//   instalment is paid, otherwise 'pending'.

function buildScenarios(ctx) {
  const { customerMap, branchMap, warehouseMap, userMap } = ctx;

  const karada = branchMap['بغداد - الكرادة'];
  const mansour = branchMap['بغداد - المنصور'];
  const basra = branchMap['البصرة - العشار'];
  const najaf = branchMap['النجف'];
  const karadaWh = warehouseMap['مخزن الكرادة الرئيسي'];
  const mansourWh = warehouseMap['مخزن المنصور'];
  const basraWh = warehouseMap['مخزن البصرة'];
  const najafWh = warehouseMap['مخزن النجف'];

  const cashier = userMap['cashier.karada'] || userMap['admin'];
  const cashierBasra = userMap['cashier.basra'] || cashier;
  const cashierNajaf = userMap['cashier.najaf'] || cashier;
  const sales = userMap['sales.karada'] || cashier;

  const cashCustomer = customerMap['عميل نقدي'];
  const goodPayer = customerMap['أحمد علي حسين'];
  const completedCustomer = customerMap['سارة حسن جواد'];
  const installmentCustomer = customerMap['محمد رضا الكاظمي'];
  const latePayer = customerMap['حيدر الجبوري'];
  const newCustomer = customerMap['نور الدين العبيدي'];
  const highDebt = customerMap['مريم العبيدي'];
  const risky = customerMap['عبدالله الشمري'];
  const completedZ = customerMap['زينب الموسوي'];
  const latePayerKirkuk = customerMap['علي حسين الزبيدي'];

  return [
    // ─────────────────────────────────────────────────────────────────────
    // CASH — fully paid POS sales spread across 4 months and 4 branches.
    // ─────────────────────────────────────────────────────────────────────
    {
      key: 'CASH-KARADA-001',
      branch: karada, warehouse: karadaWh, user: cashier,
      customer: cashCustomer, paymentType: 'cash', saleSource: 'POS',
      status: 'completed', createdAt: dateAt(2025, 11, 14, 10, 30),
      lines: [
        { sku: 'PHN-RDMN12', qty: 1, unitPrice: 310_000 },
        { sku: 'ACC-CASEIP', qty: 1, unitPrice: 5_000 },
        { sku: 'ACC-GLASS', qty: 1, unitPrice: 4_000 },
      ],
      payments: [{ amount: 319_000, method: 'cash', note: 'دفع نقدي كامل' }],
    },
    {
      key: 'CASH-KARADA-002',
      branch: karada, warehouse: karadaWh, user: sales,
      customer: goodPayer, paymentType: 'cash', saleSource: 'POS',
      status: 'completed', createdAt: dateAt(2025, 12, 3, 13, 15),
      lines: [
        { sku: 'PHN-SAMA54', qty: 1, unitPrice: 425_000 },
        { sku: 'ACC-CHRTC', qty: 1, unitPrice: 12_000 },
      ],
      payments: [{ amount: 437_000, method: 'cash', note: 'دفع نقدي كامل' }],
    },
    {
      key: 'CASH-KARADA-003',
      branch: karada, warehouse: karadaWh, user: cashier,
      customer: cashCustomer, paymentType: 'cash', saleSource: 'POS',
      status: 'completed', createdAt: dateAt(2026, 1, 8, 11, 0),
      lines: [
        { sku: 'ACC-AIRPDS', qty: 1, unitPrice: 85_000 },
        { sku: 'ACC-PWRBNK', qty: 1, unitPrice: 30_000 },
        { sku: 'ACC-CBLTC', qty: 2, unitPrice: 7_500 },
      ],
      payments: [{ amount: 130_000, method: 'card', reference: 'AUTH-99812', note: 'دفع بالبطاقة' }],
    },
    {
      key: 'CASH-MANSOUR-001',
      branch: mansour, warehouse: mansourWh, user: cashier,
      customer: cashCustomer, paymentType: 'cash', saleSource: 'POS',
      status: 'completed', createdAt: dateAt(2026, 2, 12, 16, 45),
      lines: [
        { sku: 'NET-UPS', qty: 1, unitPrice: 110_000 },
      ],
      payments: [{ amount: 110_000, method: 'cash', note: 'دفع نقدي' }],
    },
    {
      key: 'CASH-BASRA-001',
      branch: basra, warehouse: basraWh, user: cashierBasra,
      customer: newCustomer, paymentType: 'cash', saleSource: 'POS',
      status: 'completed', createdAt: dateAt(2026, 3, 5, 9, 50),
      lines: [
        { sku: 'PHN-TECNO', qty: 1, unitPrice: 175_000 },
        { sku: 'ACC-GLASS', qty: 1, unitPrice: 4_000 },
      ],
      payments: [{ amount: 179_000, method: 'cash', note: 'دفع نقدي' }],
    },
    {
      key: 'CASH-NAJAF-001',
      branch: najaf, warehouse: najafWh, user: cashierNajaf,
      customer: cashCustomer, paymentType: 'cash', saleSource: 'POS',
      status: 'completed', createdAt: dateAt(2026, 4, 2, 14, 20),
      lines: [
        { sku: 'PHN-INFNX', qty: 1, unitPrice: 195_000 },
        { sku: 'ACC-CHRTC', qty: 1, unitPrice: 12_000 },
      ],
      payments: [{ amount: 207_000, method: 'cash', note: 'دفع نقدي' }],
    },

    // ─────────────────────────────────────────────────────────────────────
    // CASH — partial payment (status 'pending', remainingAmount > 0)
    // ─────────────────────────────────────────────────────────────────────
    {
      key: 'CASH-PARTIAL-001',
      branch: karada, warehouse: karadaWh, user: sales,
      customer: latePayerKirkuk, paymentType: 'cash', saleSource: 'POS',
      status: 'pending', createdAt: dateAt(2026, 3, 21, 12, 0),
      lines: [
        { sku: 'LPT-HPPRO', qty: 1, unitPrice: 1_450_000 },
      ],
      payments: [
        { amount: 800_000, method: 'cash', note: 'دفعة أولى', dateOffsetDays: 0 },
        { amount: 250_000, method: 'cash', note: 'دفعة لاحقة', dateOffsetDays: 14 },
      ],
    },

    // ─────────────────────────────────────────────────────────────────────
    // INSTALLMENT — fully completed (paid through end of schedule)
    // ─────────────────────────────────────────────────────────────────────
    {
      key: 'INST-COMPLETED-001',
      branch: karada, warehouse: karadaWh, user: sales,
      customer: completedCustomer, paymentType: 'installment', saleSource: 'NEW_SALE',
      status: 'completed', createdAt: dateAt(2025, 10, 5, 10, 0),
      lines: [{ sku: 'PHN-IPH13', qty: 1, unitPrice: 1_250_000 }],
      installments: {
        downPayment: { amount: 250_000, method: 'cash', note: 'دفعة أولى' },
        plan: [
          { amount: 250_000, dueDate: dateAt(2025, 11, 5),  status: 'paid', paidOffsetDays: -1 },
          { amount: 250_000, dueDate: dateAt(2025, 12, 5),  status: 'paid', paidOffsetDays:  0 },
          { amount: 250_000, dueDate: dateAt(2026, 1, 5),   status: 'paid', paidOffsetDays:  1 },
          { amount: 250_000, dueDate: dateAt(2026, 2, 5),   status: 'paid', paidOffsetDays:  2 },
        ],
      },
    },
    {
      key: 'INST-COMPLETED-002',
      branch: karada, warehouse: karadaWh, user: sales,
      customer: completedZ, paymentType: 'installment', saleSource: 'NEW_SALE',
      status: 'completed', createdAt: dateAt(2025, 11, 1, 11, 0),
      lines: [{ sku: 'LPT-LNVTPD', qty: 1, unitPrice: 1_800_000 }],
      installments: {
        downPayment: { amount: 600_000, method: 'cash', note: 'دفعة أولى' },
        plan: [
          { amount: 400_000, dueDate: dateAt(2025, 12, 1),  status: 'paid', paidOffsetDays:  0 },
          { amount: 400_000, dueDate: dateAt(2026, 1, 1),   status: 'paid', paidOffsetDays: -2 },
          { amount: 400_000, dueDate: dateAt(2026, 2, 1),   status: 'paid', paidOffsetDays: -1 },
        ],
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    // INSTALLMENT — active (some paid, some pending — overdue + upcoming)
    // ─────────────────────────────────────────────────────────────────────
    {
      key: 'INST-ACTIVE-001',
      branch: karada, warehouse: karadaWh, user: sales,
      customer: installmentCustomer, paymentType: 'installment', saleSource: 'NEW_SALE',
      status: 'pending', createdAt: dateAt(2026, 1, 10, 11, 0),
      lines: [{ sku: 'PHN-IPH14P', qty: 1, unitPrice: 1_750_000 }],
      installments: {
        downPayment: { amount: 350_000, method: 'cash', note: 'دفعة أولى' },
        plan: [
          // First 2 paid (Feb, Mar). Apr is upcoming. May/Jun are upcoming.
          { amount: 280_000, dueDate: dateAt(2026, 2, 10), status: 'paid', paidOffsetDays:  0 },
          { amount: 280_000, dueDate: dateAt(2026, 3, 10), status: 'paid', paidOffsetDays:  2 },
          { amount: 280_000, dueDate: dateAt(2026, 5, 10), status: 'pending' },
          { amount: 280_000, dueDate: dateAt(2026, 6, 10), status: 'pending' },
          { amount: 280_000, dueDate: dateAt(2026, 7, 10), status: 'pending' },
        ],
      },
    },
    {
      key: 'INST-OVERDUE-001',
      branch: karada, warehouse: karadaWh, user: sales,
      customer: latePayer, paymentType: 'installment', saleSource: 'NEW_SALE',
      status: 'pending', createdAt: dateAt(2025, 12, 20, 14, 30),
      lines: [
        { sku: 'PHN-SAMA24', qty: 1, unitPrice: 275_000 },
        { sku: 'ACC-CASEIP', qty: 1, unitPrice: 5_000 },
      ],
      installments: {
        downPayment: { amount: 80_000, method: 'cash', note: 'دفعة أولى' },
        plan: [
          { amount: 50_000, dueDate: dateAt(2026, 1, 20), status: 'paid', paidOffsetDays: 1 },
          { amount: 50_000, dueDate: dateAt(2026, 2, 20), status: 'paid', paidOffsetDays: 5 },
          // Mar 20 + Apr 20 are both before TODAY (2026-04-30) → overdue
          { amount: 50_000, dueDate: dateAt(2026, 3, 20), status: 'pending' },
          { amount: 50_000, dueDate: dateAt(2026, 4, 20), status: 'pending' },
          { amount: 50_000, dueDate: dateAt(2026, 5, 20), status: 'pending' },
        ],
      },
    },
    {
      key: 'INST-OVERDUE-002',
      branch: najaf, warehouse: najafWh, user: cashierNajaf,
      customer: latePayerKirkuk, paymentType: 'installment', saleSource: 'NEW_SALE',
      status: 'pending', createdAt: dateAt(2026, 1, 25, 9, 30),
      lines: [{ sku: 'NET-UPS', qty: 1, unitPrice: 110_000 }],
      installments: {
        downPayment: { amount: 30_000, method: 'cash', note: 'دفعة أولى' },
        plan: [
          { amount: 20_000, dueDate: dateAt(2026, 2, 25), status: 'paid', paidOffsetDays: 0 },
          { amount: 20_000, dueDate: dateAt(2026, 3, 25), status: 'pending' },
          { amount: 20_000, dueDate: dateAt(2026, 4, 25), status: 'pending' },
          { amount: 20_000, dueDate: dateAt(2026, 5, 25), status: 'pending' },
        ],
      },
    },
    {
      key: 'INST-HIGHDEBT-001',
      branch: karada, warehouse: karadaWh, user: sales,
      customer: highDebt, paymentType: 'installment', saleSource: 'NEW_SALE',
      status: 'pending', createdAt: dateAt(2026, 2, 15, 10, 0),
      lines: [
        { sku: 'PHN-IPH13', qty: 1, unitPrice: 1_250_000 },
        { sku: 'ACC-AIRPDS', qty: 1, unitPrice: 85_000 },
      ],
      installments: {
        downPayment: { amount: 300_000, method: 'cash', note: 'دفعة أولى' },
        plan: [
          { amount: 175_000, dueDate: dateAt(2026, 3, 15), status: 'paid', paidOffsetDays: 1 },
          { amount: 175_000, dueDate: dateAt(2026, 4, 15), status: 'paid', paidOffsetDays: 0 },
          { amount: 175_000, dueDate: dateAt(2026, 5, 15), status: 'pending' },
          { amount: 175_000, dueDate: dateAt(2026, 6, 15), status: 'pending' },
          { amount: 170_000, dueDate: dateAt(2026, 7, 15), status: 'pending' },
          { amount: 165_000, dueDate: dateAt(2026, 8, 15), status: 'pending' },
        ],
      },
    },
    {
      key: 'INST-HIGHDEBT-002',
      branch: karada, warehouse: karadaWh, user: sales,
      customer: highDebt, paymentType: 'installment', saleSource: 'NEW_SALE',
      status: 'pending', createdAt: dateAt(2026, 3, 18, 12, 0),
      lines: [{ sku: 'SCR-SAM32', qty: 1, unitPrice: 375_000 }],
      installments: {
        downPayment: { amount: 75_000, method: 'cash', note: 'دفعة أولى' },
        plan: [
          { amount: 75_000, dueDate: dateAt(2026, 4, 18), status: 'paid', paidOffsetDays: 0 },
          { amount: 75_000, dueDate: dateAt(2026, 5, 18), status: 'pending' },
          { amount: 75_000, dueDate: dateAt(2026, 6, 18), status: 'pending' },
          { amount: 75_000, dueDate: dateAt(2026, 7, 18), status: 'pending' },
        ],
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    // DRAFT invoices (no payments, no inventory deduction, no issued_at)
    // ─────────────────────────────────────────────────────────────────────
    {
      key: 'DRAFT-CASH-001',
      branch: karada, warehouse: karadaWh, user: cashier,
      customer: cashCustomer, paymentType: 'cash', saleSource: 'POS',
      status: 'draft', createdAt: dateAt(2026, 4, 28, 17, 5),
      lines: [
        { sku: 'PHN-SAMA24', qty: 1, unitPrice: 275_000 },
        { sku: 'ACC-CHRTC', qty: 1, unitPrice: 12_000 },
      ],
      payments: [],
    },
    {
      key: 'DRAFT-INST-001',
      branch: karada, warehouse: karadaWh, user: sales,
      customer: goodPayer, paymentType: 'installment', saleSource: 'NEW_SALE',
      status: 'draft', createdAt: dateAt(2026, 4, 29, 14, 30),
      lines: [{ sku: 'LPT-HPPRO', qty: 1, unitPrice: 1_450_000 }],
      payments: [],
    },

    // ─────────────────────────────────────────────────────────────────────
    // RISKY customer — small completed cash sale (no installments). The
    // customer's low credit score is what makes them "blacklisted" in the
    // UI; the schema has no boolean blacklist column.
    // ─────────────────────────────────────────────────────────────────────
    {
      key: 'CASH-RISKY-001',
      branch: karada, warehouse: karadaWh, user: cashier,
      customer: risky, paymentType: 'cash', saleSource: 'POS',
      status: 'completed', createdAt: dateAt(2026, 2, 27, 13, 0),
      lines: [
        { sku: 'ACC-CHRTC', qty: 2, unitPrice: 12_000 },
        { sku: 'ACC-CBLTC', qty: 1, unitPrice: 7_500 },
      ],
      payments: [{ amount: 31_500, method: 'cash', note: 'دفع نقدي' }],
    },

    // ─────────────────────────────────────────────────────────────────────
    // CANCELLED — a sale that was created and then cancelled. No payments,
    // no stock decrement (we never decrement for cancelled sales).
    // ─────────────────────────────────────────────────────────────────────
    {
      key: 'CASH-CANCELLED-001',
      branch: karada, warehouse: karadaWh, user: sales,
      customer: cashCustomer, paymentType: 'cash', saleSource: 'POS',
      status: 'cancelled', createdAt: dateAt(2026, 1, 22, 10, 10),
      skipStock: true,
      lines: [{ sku: 'ACC-PWRBNK', qty: 1, unitPrice: 30_000 }],
      payments: [],
    },
  ];
}

async function applySaleScenarios(db, scenarios, ctx) {
  const created = {};
  let appliedCount = 0;
  for (const scenario of scenarios) {
    const invoiceNumber = `SEED-${scenario.key}`;
    const existing = await findOne(db, sales, eq(sales.invoiceNumber, invoiceNumber));
    if (existing) {
      created[scenario.key] = existing;
      continue;
    }

    const subtotal = scenario.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const total = subtotal;

    const isInstallment = !!scenario.installments;
    const downPayment = isInstallment ? scenario.installments.downPayment : null;
    const installmentPlan = isInstallment ? scenario.installments.plan : [];

    // Compute cash flow & resulting paid/remaining amount before inserting.
    const cashPayments = isInstallment
      ? (downPayment ? [downPayment] : [])
      : (scenario.payments || []);
    const cashPaid = cashPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const installmentPaidSum = installmentPlan
      .filter((i) => i.status === 'paid')
      .reduce((s, i) => s + Number(i.amount || 0), 0);
    const totalPaid = cashPaid + installmentPaidSum;
    const remaining = Math.max(0, Number((total - totalPaid).toFixed(4)));

    // Resolve declared status. Drafts keep `issued_at` NULL; everything
    // else carries an issued_at = createdAt.
    const status = scenario.status;
    const issuedAt = status === 'draft' ? null : scenario.createdAt;

    const sale = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(sales)
        .values({
          invoiceNumber,
          customerId: scenario.customer?.id || null,
          branchId: scenario.branch?.id || null,
          warehouseId: scenario.warehouse?.id || null,
          cashSessionId: null,
          subtotal: D(subtotal),
          discount: '0',
          tax: '0',
          total: D(total),
          currency: IQD,
          exchangeRate: '1',
          interestRate: '0',
          interestAmount: '0',
          paymentType: scenario.paymentType,
          saleSource: scenario.saleSource,
          saleType: scenario.paymentType === 'installment' ? 'INSTALLMENT' : 'CASH',
          paidAmount: D(totalPaid),
          remainingAmount: D(remaining),
          status,
          notes: 'Iraqi market deterministic seed',
          issuedAt,
          createdAt: scenario.createdAt,
          updatedAt: scenario.createdAt,
          createdBy: scenario.user?.id || ctx.adminId,
        })
        .returning();

      // Sale items
      const insertedItems = [];
      for (const line of scenario.lines) {
        const product = ctx.productMap[line.sku];
        if (!product) {
          throw new Error(`Seed scenario references unknown SKU: ${line.sku}`);
        }
        const [si] = await tx
          .insert(saleItems)
          .values({
            saleId: row.id,
            productId: product.id,
            productName: product.name,
            quantity: line.qty,
            unitPrice: D(line.unitPrice),
            discount: '0',
            subtotal: D(line.qty * line.unitPrice),
            createdAt: scenario.createdAt,
          })
          .returning();
        insertedItems.push({ ...si, _line: line });
      }

      // Stock decrement + stock_movement for non-draft, non-cancelled sales.
      if (status !== 'draft' && status !== 'cancelled' && !scenario.skipStock) {
        for (const line of scenario.lines) {
          const product = ctx.productMap[line.sku];
          const ps = (await tx
            .select()
            .from(productStock)
            .where(
              and(
                eq(productStock.productId, product.id),
                eq(productStock.warehouseId, scenario.warehouse.id)
              )
            )
            .limit(1))[0];
          if (!ps) continue; // warehouse has no stock row — skip silently
          const before = Number(ps.quantity || 0);
          const after = Math.max(0, before - line.qty);
          await tx
            .update(productStock)
            .set({ quantity: after })
            .where(eq(productStock.id, ps.id));
          await tx.insert(stockMovements).values({
            productId: product.id,
            warehouseId: scenario.warehouse.id,
            movementType: 'sale',
            quantityChange: -line.qty,
            quantityBefore: before,
            quantityAfter: after,
            referenceType: 'sale',
            referenceId: row.id,
            notes: `Seed sale ${invoiceNumber}`,
            createdBy: scenario.user?.id || ctx.adminId,
          });
        }
      }

      // Cash payments (or installment down-payment)
      for (const pay of cashPayments) {
        const offset = pay.dateOffsetDays || 0;
        const paymentDate = addDays(scenario.createdAt, offset);
        await tx.insert(payments).values({
          saleId: row.id,
          customerId: scenario.customer?.id || null,
          amount: D(pay.amount),
          currency: IQD,
          exchangeRate: '1',
          paymentMethod: pay.method,
          paymentReference: pay.reference || null,
          paymentDate,
          notes: pay.note || null,
          createdAt: paymentDate,
          createdBy: scenario.user?.id || ctx.adminId,
        });
      }

      // Installment schedule + payments for paid installments
      if (isInstallment) {
        for (let k = 0; k < installmentPlan.length; k++) {
          const plan = installmentPlan[k];
          const dueDateStr = fmtDate(plan.dueDate);
          const paidDate =
            plan.status === 'paid'
              ? addDays(plan.dueDate, plan.paidOffsetDays || 0)
              : null;
          await tx.insert(installments).values({
            saleId: row.id,
            customerId: scenario.customer?.id || null,
            installmentNumber: k + 1,
            dueAmount: D(plan.amount),
            paidAmount: plan.status === 'paid' ? D(plan.amount) : '0',
            remainingAmount: plan.status === 'paid' ? '0' : D(plan.amount),
            currency: IQD,
            dueDate: dueDateStr,
            paidDate: paidDate ? fmtDate(paidDate) : null,
            status: plan.status, // 'paid' | 'pending'
            notes: null,
            createdAt: scenario.createdAt,
            updatedAt: paidDate || scenario.createdAt,
            createdBy: scenario.user?.id || ctx.adminId,
          });

          if (plan.status === 'paid' && paidDate) {
            await tx.insert(payments).values({
              saleId: row.id,
              customerId: scenario.customer?.id || null,
              amount: D(plan.amount),
              currency: IQD,
              exchangeRate: '1',
              paymentMethod: 'cash',
              paymentReference: null,
              paymentDate: paidDate,
              notes: `قسط رقم ${k + 1}`,
              createdAt: paidDate,
              createdBy: scenario.user?.id || ctx.adminId,
            });
          }
        }
      }

      return { sale: row, items: insertedItems };
    });

    created[scenario.key] = sale.sale;
    appliedCount++;
  }
  log.ok(`sales scenarios (${appliedCount} new, ${scenarios.length} total)`);
  return created;
}

// ── Sale returns ──────────────────────────────────────────────────────────
async function seedSaleReturns(db, saleMap, productMap, userMap) {
  // Return one phone case from CASH-KARADA-001 (cash refund) and the screen
  // protector from CASH-NAJAF-001 (debt reduction not applicable — full
  // refund). Each return restores stock via stock_movements 'sale_return'.
  const adminId = userMap['admin']?.id;

  async function applyReturn({ scenarioKey, refundMethod, items, reason, daysAfter, createdBy }) {
    const sale = saleMap[scenarioKey];
    if (!sale) return;
    const exists = (await db
      .select()
      .from(saleReturns)
      .where(eq(saleReturns.saleId, sale.id))
      .limit(1))[0];
    if (exists) return;

    return await db.transaction(async (tx) => {
      const saleItemRows = await tx.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
      const returnedValue = items.reduce((s, ri) => s + ri.quantity * ri.unitPrice, 0);
      const refundAmount = returnedValue;
      const debtReduction = 0;
      const createdAt = addDays(new Date(sale.createdAt), daysAfter);

      const [ret] = await tx
        .insert(saleReturns)
        .values({
          saleId: sale.id,
          customerId: sale.customerId,
          branchId: sale.branchId,
          warehouseId: sale.warehouseId,
          returnedValue: D(returnedValue),
          refundAmount: D(refundAmount),
          debtReduction: D(debtReduction),
          refundMethod,
          refundReference: null,
          currency: IQD,
          reason,
          notes: 'Iraqi market seed return',
          createdAt,
          createdBy: createdBy || adminId,
        })
        .returning();

      for (const ri of items) {
        const product = productMap[ri.sku];
        const matchedSi = saleItemRows.find((si) => si.productId === product.id);
        await tx.insert(saleReturnItems).values({
          returnId: ret.id,
          saleItemId: matchedSi?.id || null,
          productId: product.id,
          productName: product.name,
          quantity: ri.quantity,
          unitPrice: D(ri.unitPrice),
          subtotal: D(ri.quantity * ri.unitPrice),
          createdAt,
        });

        // Stock restoration
        const ps = (await tx
          .select()
          .from(productStock)
          .where(and(eq(productStock.productId, product.id), eq(productStock.warehouseId, sale.warehouseId)))
          .limit(1))[0];
        if (ps) {
          const before = Number(ps.quantity || 0);
          const after = before + ri.quantity;
          await tx.update(productStock).set({ quantity: after }).where(eq(productStock.id, ps.id));
          await tx.insert(stockMovements).values({
            productId: product.id,
            warehouseId: sale.warehouseId,
            movementType: 'sale_return',
            quantityChange: ri.quantity,
            quantityBefore: before,
            quantityAfter: after,
            referenceType: 'sale_return',
            referenceId: ret.id,
            notes: `Seed return for sale ${sale.invoiceNumber}`,
            createdBy: createdBy || adminId,
          });
        }
      }

      // Mirror saleService.createReturn:
      //   paidAmount      ← max(0, paid - refundAmount)
      //   remainingAmount ← max(0, remaining - debtReduction)
      // — paidAmount drops only by the cash actually refunded; the
      // outstanding debt only drops by the portion forgiven (debtReduction),
      // not by the full returned value.
      const newPaid = Math.max(0, Number(sale.paidAmount) - refundAmount);
      const newRemaining = Math.max(0, Number(sale.remainingAmount) - debtReduction);
      await tx
        .update(sales)
        .set({
          paidAmount: D(newPaid),
          remainingAmount: D(newRemaining),
          updatedAt: createdAt,
        })
        .where(eq(sales.id, sale.id));
    });
  }

  await applyReturn({
    scenarioKey: 'CASH-KARADA-001',
    refundMethod: 'cash',
    items: [{ sku: 'ACC-CASEIP', quantity: 1, unitPrice: 5_000 }],
    reason: 'الزبون أعاد الكفر — مقاسه غير مطابق',
    daysAfter: 2,
    createdBy: userMap['cashier.karada']?.id,
  });

  await applyReturn({
    scenarioKey: 'CASH-NAJAF-001',
    refundMethod: 'cash',
    items: [{ sku: 'ACC-CHRTC', quantity: 1, unitPrice: 12_000 }],
    reason: 'شاحن غير مطابق للموبايل',
    daysAfter: 5,
    createdBy: userMap['cashier.najaf']?.id,
  });

  log.ok('sale returns');
}

// ── Cash sessions ─────────────────────────────────────────────────────────
async function seedCashSessions(db, userMap, branchMap, saleMap) {
  const karada = branchMap['بغداد - الكرادة'];
  const cashier = userMap['cashier.karada'];
  if (!karada || !cashier) {
    log.skip('cash sessions — missing prerequisites');
    return;
  }

  // 1. A closed session (yesterday, fully reconciled).
  // expected_cash = opening + cash_in − cash_out. We pick a clean number
  // and link the most recent same-branch cash sale to the session so the
  // closing report reflects real cash inflow.
  const closedOpenedAt = addDays(TODAY, -1);
  closedOpenedAt.setUTCHours(8, 0, 0, 0);
  const closedClosedAt = addDays(TODAY, -1);
  closedClosedAt.setUTCHours(20, 0, 0, 0);

  const closedExisting = (await db
    .select()
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.userId, cashier.id),
        eq(cashSessions.branchId, karada.id),
        eq(cashSessions.status, 'closed')
      )
    )
    .limit(1))[0];
  let closedId = closedExisting?.id;
  if (!closedExisting) {
    const opening = 200_000;
    const cashIn = 0; // no sales linked retroactively to keep the math clean
    const cashOut = 0;
    const expected = opening + cashIn - cashOut;
    const closing = expected; // no variance
    const variance = 0;
    const [row] = await db
      .insert(cashSessions)
      .values({
        userId: cashier.id,
        branchId: karada.id,
        openingCash: D(opening),
        closingCash: D(closing),
        expectedCash: D(expected),
        variance: D(variance),
        currency: IQD,
        status: 'closed',
        notes: 'وردية الأمس — تمت التسوية بدون فرق',
        openedAt: closedOpenedAt,
        closedAt: closedClosedAt,
      })
      .returning();
    closedId = row.id;
  }

  // 2. An open session for today. The unique partial index forbids two open
  // sessions for the same (user, branch); skip if one already exists.
  const openExisting = (await db
    .select()
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.userId, cashier.id),
        eq(cashSessions.branchId, karada.id),
        eq(cashSessions.status, 'open')
      )
    )
    .limit(1))[0];
  if (!openExisting) {
    const openedAt = new Date(TODAY);
    openedAt.setUTCHours(8, 30, 0, 0);
    await db.insert(cashSessions).values({
      userId: cashier.id,
      branchId: karada.id,
      openingCash: D(150_000),
      currency: IQD,
      status: 'open',
      notes: 'وردية اليوم - مفتوحة',
      openedAt,
    });
  }

  // Backlink the most recent Karada cash POS sale to the closed session so
  // reports & profile views show "this sale belongs to that shift".
  const target = saleMap['CASH-KARADA-003'];
  if (target && closedId && !target.cashSessionId) {
    await db
      .update(sales)
      .set({ cashSessionId: closedId })
      .where(eq(sales.id, target.id));
    await db
      .update(payments)
      .set({ cashSessionId: closedId })
      .where(eq(payments.saleId, target.id));
  }

  log.ok('cash sessions');
}

// ── Expenses ──────────────────────────────────────────────────────────────
async function seedExpenses(db, branchMap, userMap) {
  const karada = branchMap['بغداد - الكرادة'];
  const basra = branchMap['البصرة - العشار'];
  const najaf = branchMap['النجف'];
  const accountant = userMap['accountant'] || userMap['admin'];
  if (!karada) return;

  const defs = [
    { branch: karada, category: 'rent',      amount: 1_500_000, note: 'إيجار محل الكرادة - شباط',     date: '2026-02-01' },
    { branch: karada, category: 'rent',      amount: 1_500_000, note: 'إيجار محل الكرادة - آذار',     date: '2026-03-01' },
    { branch: karada, category: 'rent',      amount: 1_500_000, note: 'إيجار محل الكرادة - نيسان',    date: '2026-04-01' },
    { branch: karada, category: 'salary',    amount: 4_500_000, note: 'رواتب شباط',                   date: '2026-02-28' },
    { branch: karada, category: 'salary',    amount: 4_500_000, note: 'رواتب آذار',                    date: '2026-03-31' },
    { branch: karada, category: 'utilities', amount:   150_000, note: 'كهرباء وأمبيرات — آذار',         date: '2026-03-25' },
    { branch: karada, category: 'utilities', amount:   180_000, note: 'كهرباء وأمبيرات — نيسان',        date: '2026-04-25' },
    { branch: karada, category: 'supplies',  amount:    75_000, note: 'مستلزمات تنظيف وقرطاسية',       date: '2026-03-15' },
    { branch: karada, category: 'marketing', amount:   220_000, note: 'بنرات إعلانية وإعلان ممول',     date: '2026-02-20' },
    { branch: basra,  category: 'rent',      amount:   900_000, note: 'إيجار فرع البصرة - آذار',       date: '2026-03-01' },
    { branch: basra,  category: 'salary',    amount: 1_800_000, note: 'راتب كاشير البصرة - آذار',      date: '2026-03-31' },
    { branch: basra,  category: 'transport', amount:    50_000, note: 'نقل بضاعة من الكرادة',          date: '2026-03-20' },
    { branch: najaf,  category: 'rent',      amount:   700_000, note: 'إيجار فرع النجف - نيسان',       date: '2026-04-01' },
    { branch: najaf,  category: 'salary',    amount: 1_500_000, note: 'راتب كاشير النجف - نيسان',      date: '2026-04-30' },
    { branch: karada, category: 'maintenance', amount: 120_000, note: 'صيانة جهاز كاشير POS',          date: '2026-04-12' },
    { branch: karada, category: 'tax',       amount:   300_000, note: 'ضريبة محلية ربعية',              date: '2026-03-10' },
  ];

  let inserted = 0;
  for (const def of defs) {
    // Idempotency: dedupe by (branchId, expenseDate, note).
    const existing = (await db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.branchId, def.branch.id),
          eq(expenses.expenseDate, def.date),
          eq(expenses.note, def.note)
        )
      )
      .limit(1))[0];
    if (existing) continue;
    await db.insert(expenses).values({
      branchId: def.branch.id,
      category: def.category,
      amount: D(def.amount),
      currency: IQD,
      note: def.note,
      expenseDate: def.date,
      createdBy: accountant?.id || null,
    });
    inserted++;
  }
  log.ok(`expenses (${inserted} new)`);
}

// ── Warehouse transfers ───────────────────────────────────────────────────
async function seedWarehouseTransfers(db, branchMap, warehouseMap, productMap, userMap) {
  const karada = branchMap['بغداد - الكرادة'];
  const main = warehouseMap['مخزن الكرادة الرئيسي'];
  const acc = warehouseMap['مخزن الكرادة - الإكسسوارات'];
  const reqUser = userMap['branch.manager.karada'] || userMap['admin'];
  const apprUser = userMap['branch.admin.karada'] || userMap['admin'];
  if (!karada || !main || !acc) return;

  // Approved transfer — 5x شاحن Type-C from main to accessories warehouse.
  const charger = productMap['ACC-CHRTC'];
  const existingApproved = (await db
    .select()
    .from(warehouseTransfers)
    .where(
      and(
        eq(warehouseTransfers.branchId, karada.id),
        eq(warehouseTransfers.productId, charger.id),
        eq(warehouseTransfers.status, 'approved')
      )
    )
    .limit(1))[0];
  if (!existingApproved) {
    await db.insert(warehouseTransfers).values({
      branchId: karada.id,
      fromWarehouseId: main.id,
      toWarehouseId: acc.id,
      productId: charger.id,
      quantity: 5,
      status: 'approved',
      requestedBy: reqUser.id,
      approvedBy: apprUser.id,
      approvedAt: addDays(TODAY, -7),
      notes: 'تجهيز رف الإكسسوارات',
      createdAt: addDays(TODAY, -8),
    });
  }

  // Pending transfer awaiting approval.
  const cable = productMap['ACC-CBLTC'];
  const existingPending = (await db
    .select()
    .from(warehouseTransfers)
    .where(
      and(
        eq(warehouseTransfers.branchId, karada.id),
        eq(warehouseTransfers.productId, cable.id),
        eq(warehouseTransfers.status, 'pending')
      )
    )
    .limit(1))[0];
  if (!existingPending) {
    await db.insert(warehouseTransfers).values({
      branchId: karada.id,
      fromWarehouseId: main.id,
      toWarehouseId: acc.id,
      productId: cable.id,
      quantity: 10,
      status: 'pending',
      requestedBy: reqUser.id,
      notes: 'لتعبئة الرف الأمامي',
      createdAt: addDays(TODAY, -1),
    });
  }
  log.ok('warehouse transfers');
}

// ── Installment collection actions ────────────────────────────────────────
async function seedInstallmentActions(db, saleMap, userMap) {
  const collector = userMap['branch.manager.karada'] || userMap['admin'];

  async function actionsFor(scenarioKey, builder) {
    const sale = saleMap[scenarioKey];
    if (!sale) return;
    const inst = await db
      .select()
      .from(installments)
      .where(eq(installments.saleId, sale.id));
    if (inst.length === 0) return;

    // Idempotency: skip if any action already exists for this sale.
    const existing = (await db
      .select()
      .from(installmentActions)
      .where(eq(installmentActions.saleId, sale.id))
      .limit(1))[0];
    if (existing) return;

    const planned = builder(inst);
    for (const a of planned) {
      await db.insert(installmentActions).values({
        installmentId: a.installmentId,
        customerId: sale.customerId,
        saleId: sale.id,
        userId: collector.id,
        actionType: a.actionType,
        note: a.note || null,
        promisedAmount: a.promisedAmount != null ? D(a.promisedAmount) : null,
        promisedDate: a.promisedDate || null,
        oldDueDate: a.oldDueDate || null,
        newDueDate: a.newDueDate || null,
        paymentId: null,
        createdAt: a.createdAt || TODAY,
      });
    }
  }

  // INST-OVERDUE-001 (حيدر الجبوري): one call + a promise to pay
  await actionsFor('INST-OVERDUE-001', (inst) => {
    const overdue = inst.find((i) => i.installmentNumber === 3);
    if (!overdue) return [];
    return [
      {
        installmentId: overdue.id,
        actionType: 'call',
        note: 'تم الاتصال بالزبون - وعد بالدفع نهاية الأسبوع',
        createdAt: addDays(TODAY, -10),
      },
      {
        installmentId: overdue.id,
        actionType: 'promise_to_pay',
        promisedAmount: 50_000,
        promisedDate: fmtDate(addDays(TODAY, 5)),
        note: 'وعد رسمي بالدفع',
        createdAt: addDays(TODAY, -9),
      },
    ];
  });

  // INST-OVERDUE-002 (علي الزبيدي): reschedule one installment
  await actionsFor('INST-OVERDUE-002', (inst) => {
    const due = inst.find((i) => i.installmentNumber === 2);
    if (!due) return [];
    return [
      {
        installmentId: due.id,
        actionType: 'reschedule',
        oldDueDate: due.dueDate,
        newDueDate: fmtDate(addDays(TODAY, 7)),
        note: 'تأجيل القسط لمدة أسبوع',
        createdAt: addDays(TODAY, -2),
      },
      {
        installmentId: due.id,
        actionType: 'note',
        note: 'الزبون مسافر - متابعة لاحقة',
        createdAt: addDays(TODAY, -2),
      },
    ];
  });

  log.ok('installment actions');
}

// ── Notifications (queue rows for demo) ───────────────────────────────────
async function seedNotifications(db, saleMap, userMap) {
  const adminId = userMap['admin']?.id;
  // Sample notifications: an overdue reminder waiting in the queue and a
  // successfully sent payment confirmation. The queue worker will only
  // process them if the operator enables the messaging feature in the UI.
  const overdueSale = saleMap['INST-OVERDUE-001'];
  const completedSale = saleMap['INST-COMPLETED-001'];

  async function ensure(dedupeKey, values) {
    const existing = (await db
      .select()
      .from(notifications)
      .where(eq(notifications.dedupeKey, dedupeKey))
      .limit(1))[0];
    if (existing) return;
    await db.insert(notifications).values(values);
  }

  if (overdueSale && overdueSale.customerId) {
    const cust = (await db.select().from(customers).where(eq(customers.id, overdueSale.customerId)).limit(1))[0];
    if (cust?.normalizedPhone) {
      await ensure(`seed:overdue:${overdueSale.id}`, {
        type: 'overdue_reminder',
        channel: 'auto',
        recipientPhone: cust.normalizedPhone,
        customerId: cust.id,
        saleId: overdueSale.id,
        template: 'overdue_reminder',
        messageBody: `عزيزي ${cust.name}، لديك قسط متأخر مستحق على فاتورة ${overdueSale.invoiceNumber}. يرجى التواصل معنا للسداد.`,
        status: 'pending',
        attempts: 0,
        maxAttempts: 5,
        nextAttemptAt: TODAY,
        dedupeKey: `seed:overdue:${overdueSale.id}`,
        createdBy: adminId,
      });
    }
  }

  if (completedSale && completedSale.customerId) {
    const cust = (await db.select().from(customers).where(eq(customers.id, completedSale.customerId)).limit(1))[0];
    if (cust?.normalizedPhone) {
      await ensure(`seed:complete:${completedSale.id}`, {
        type: 'payment_confirmation',
        channel: 'sms',
        resolvedChannel: 'sms',
        recipientPhone: cust.normalizedPhone,
        customerId: cust.id,
        saleId: completedSale.id,
        template: 'payment_confirmation',
        messageBody: `شكراً ${cust.name}، تم استلام دفعتكم الأخيرة وإغلاق الفاتورة ${completedSale.invoiceNumber}.`,
        status: 'sent',
        attempts: 1,
        maxAttempts: 5,
        nextAttemptAt: addDays(TODAY, -30),
        sentAt: addDays(TODAY, -30),
        dedupeKey: `seed:complete:${completedSale.id}`,
        createdBy: adminId,
      });
    }
  }
  log.ok('notifications');
}

// ── Customer aggregates ───────────────────────────────────────────────────
async function recalcCustomerTotals(db) {
  // Recompute totalPurchases and totalDebt from the seeded sales so the
  // customers list / profile view shows the correct numbers without having
  // to run a maintenance job. We do NOT touch creditScore here — that's
  // owned by the credit scoring job.
  const aggRows = await db.execute(sql`
    SELECT
      c.id AS customer_id,
      COALESCE(SUM(CASE WHEN s.status <> 'cancelled' AND s.status <> 'draft' THEN s.total END), 0) AS total_purchases,
      COALESCE(SUM(CASE WHEN s.status <> 'cancelled' AND s.status <> 'draft' THEN s.remaining_amount END), 0) AS total_debt
    FROM customers c
    LEFT JOIN sales s ON s.customer_id = c.id
    GROUP BY c.id
  `);
  const rows = aggRows.rows ?? aggRows;
  for (const r of rows) {
    await db
      .update(customers)
      .set({
        totalPurchases: D(Number(r.total_purchases)),
        totalDebt: D(Number(r.total_debt)),
      })
      .where(eq(customers.id, Number(r.customer_id)));
  }
  log.ok('customer totals recalculated');
}

async function seedAuditLogStarter(db, userMap) {
  const admin = userMap['admin'];
  if (!admin) return;
  const existing = await findOne(db, auditLog, eq(auditLog.action, 'seed:initialized'));
  if (existing) return;
  await db.insert(auditLog).values({
    userId: admin.id,
    username: admin.username,
    action: 'seed:initialized',
    resource: 'system',
    resourceId: null,
    details: JSON.stringify({
      at: new Date().toISOString(),
      mode: MODE_DEMO ? 'demo' : 'base',
      market: 'iraq',
      currency: IQD,
    }),
    ipAddress: '127.0.0.1',
  });
  log.ok('audit_log starter');
}

// ── Reset helpers ─────────────────────────────────────────────────────────
const TRUNCATE_ORDER = [
  // Children first so FK CASCADE never tries to step on something we've
  // already truncated.
  'audit_log',
  'notification_logs',
  'notifications',
  'notification_settings',
  'installment_actions',
  'sale_return_items',
  'sale_returns',
  'stock_movements',
  'warehouse_transfers',
  'product_stock',
  'installments',
  'payments',
  'sale_items',
  'invoice_sequences',
  'idempotency_keys',
  'cash_sessions',
  'sales',
  'expenses',
  'products',
  'categories',
  'customers',
  'credit_events',
  'credit_scores',
  'credit_snapshots',
  'warehouses',
  'branches',
  'users',
  'currency_settings',
  'settings',
];

async function resetDemoData() {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of TRUNCATE_ORDER) {
      const exists = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
        [table]
      );
      if (exists.rowCount === 0) continue;
      await client.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
    }
    await client.query('COMMIT');
    log.ok('demo tables truncated');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────
async function runSeed() {
  assertEnvironment();

  const modeLabel = MODE_RESET ? 'reset+seed' : MODE_DEMO ? 'demo' : 'base';
  log.info(`mode=${modeLabel} env=${NODE_ENV}`);

  const db = await getDb();

  if (MODE_RESET) {
    log.info('resetting demo data...');
    await resetDemoData();
  }

  log.info('seeding foundation...');
  await seedCurrencies(db);
  await seedSettings(db);
  await seedNotificationSettings(db);
  const userMap = await seedUsers(db);
  const branchMap = await seedBranches(db);
  const warehouseMap = await seedWarehouses(db, branchMap);
  await bindUsersToScopes(db, userMap, branchMap, warehouseMap);

  log.info('seeding catalog...');
  const adminId = userMap['admin']?.id;
  const catMap = await seedCategories(db, adminId);
  const productMap = await seedProducts(db, catMap, adminId);
  await distributeStock(db, productMap, warehouseMap, adminId);

  log.info('seeding customers...');
  const customerMap = await seedCustomers(db, adminId);

  if (MODE_DEMO) {
    log.info('seeding sales / payments / installments / drafts...');
    const ctx = {
      productMap,
      branchMap,
      warehouseMap,
      userMap,
      customerMap,
      adminId,
    };
    const scenarios = buildScenarios(ctx);
    const saleMap = await applySaleScenarios(db, scenarios, ctx);

    log.info('seeding returns...');
    await seedSaleReturns(db, saleMap, productMap, userMap);

    log.info('seeding cash sessions...');
    await seedCashSessions(db, userMap, branchMap, saleMap);

    log.info('seeding expenses...');
    await seedExpenses(db, branchMap, userMap);

    log.info('seeding warehouse transfers...');
    await seedWarehouseTransfers(db, branchMap, warehouseMap, productMap, userMap);

    log.info('seeding installment actions...');
    await seedInstallmentActions(db, saleMap, userMap);

    log.info('seeding notifications...');
    await seedNotifications(db, saleMap, userMap);

    log.info('recalculating customer totals...');
    await recalcCustomerTotals(db);
  } else {
    log.skip('demo scenarios skipped (use --demo or seed:demo)');
  }

  await seedAuditLogStarter(db, userMap);

  log.info('done');
}

runSeed()
  .then(async () => {
    await closeDatabase();
    process.exit(0);
  })
  .catch(async (error) => {
    log.err(error.message);
    if (process.env.SEED_DEBUG === 'true') console.error(error.stack);
    try {
      await closeDatabase();
    } catch (_) {}
    process.exit(1);
  });
