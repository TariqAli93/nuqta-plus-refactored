import { getDb, getPool, closeDatabase } from './db.js';
import {
  users,
  customers,
  categories,
  products,
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
  auditLog,
} from './models/index.js';
import { hashPassword } from './utils/helpers.js';
import { and, eq } from 'drizzle-orm';

// ── CLI flags ─────────────────────────────────────────────────────────────
const ARGS = new Set(process.argv.slice(2));
const HAS_FLAG = (...names) => names.some((n) => ARGS.has(n));
const MODE_RESET = HAS_FLAG('--reset');
const MODE_DEMO = HAS_FLAG('--demo');

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

// ── Deterministic helpers ─────────────────────────────────────────────────
const D = (n) => String(Number(n).toFixed(4));
const dateAt = (year, month, day, hour = 12, minute = 0) =>
  new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
const fmtDate = (d) => d.toISOString().slice(0, 10);

const FIXED_BASE = dateAt(2026, 1, 15);

// ── Find-or-create / upsert helpers ───────────────────────────────────────
async function findOne(db, table, whereExpr) {
  const rows = await db.select().from(table).where(whereExpr).limit(1);
  return rows[0] || null;
}

async function upsertByUnique(db, table, uniqueCol, uniqueValue, values) {
  const existing = await findOne(db, table, eq(uniqueCol, uniqueValue));
  if (existing) return existing;
  const [row] = await db.insert(table).values(values).returning();
  return row;
}

// ── Domain seed: foundation ───────────────────────────────────────────────
async function seedCurrencies(db) {
  const data = [
    { currencyCode: 'IQD', currencyName: 'دينار عراقي', symbol: 'د.ع', exchangeRate: '1', isBaseCurrency: true, isActive: true },
    { currencyCode: 'USD', currencyName: 'دولار أمريكي', symbol: '$', exchangeRate: '1450', isBaseCurrency: false, isActive: true },
  ];
  let inserted = 0;
  for (const row of data) {
    const existing = await findOne(db, currencySettings, eq(currencySettings.currencyCode, row.currencyCode));
    if (existing) continue;
    await db.insert(currencySettings).values(row);
    inserted++;
  }
  log.ok(`currencies (${inserted} new)`);
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
      }),
      description: 'Feature toggles for optional product modules',
    },
    { key: 'company.name', value: 'Nuqta+ Demo', description: 'اسم الشركة' },
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
  const password = await hashPassword('Passw0rd!');
  const adminPassword = await hashPassword('Admin@123');

  const definitions = [
    { username: 'admin', fullName: 'مدير النظام', role: 'admin', phone: '07700000001', password: adminPassword },
    { username: 'global.admin', fullName: 'Global Admin', role: 'global_admin', phone: '07700000002', password },
    { username: 'branch.admin', fullName: 'Branch Admin (Main)', role: 'branch_admin', phone: '07700000003', password },
    { username: 'branch.manager', fullName: 'Branch Manager (Main)', role: 'branch_manager', phone: '07700000004', password },
    { username: 'sales', fullName: 'Sales / Cashier', role: 'cashier', phone: '07700000005', password },
    { username: 'viewer', fullName: 'Restricted Viewer', role: 'viewer', phone: '07700000006', password },
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
    { name: 'الفرع الرئيسي', address: 'بغداد - المركز' },
    { name: 'فرع البصرة', address: 'البصرة - العشار' },
    { name: 'فرع أربيل', address: 'أربيل - عينكاوة' },
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
    { name: 'المخزن الرئيسي', branch: 'الفرع الرئيسي', isDefault: true },
    { name: 'مخزن الفرع الرئيسي - الإكسسوارات', branch: 'الفرع الرئيسي', isDefault: false },
    { name: 'مخزن البصرة', branch: 'فرع البصرة', isDefault: true },
    { name: 'مخزن أربيل', branch: 'فرع أربيل', isDefault: true },
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
  const main = branchMap['الفرع الرئيسي'];
  const mainWh = warehouseMap['المخزن الرئيسي'];
  const updates = [
    { user: 'branch.admin', branchId: main?.id, warehouseId: null },
    { user: 'branch.manager', branchId: main?.id, warehouseId: null },
    { user: 'sales', branchId: main?.id, warehouseId: mainWh?.id },
    { user: 'viewer', branchId: main?.id, warehouseId: mainWh?.id },
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
    { name: 'هواتف ذكية', description: 'أحدث الهواتف' },
    { name: 'حواسيب محمولة', description: 'لابتوبات للأعمال والألعاب' },
    { name: 'إكسسوارات', description: 'شواحن، سماعات، وكفرات' },
    { name: 'أجهزة منزلية', description: 'خلاطات، مكانس' },
    { name: 'مواد غذائية', description: 'رز، زيت، معلبات' },
  ];
  const result = {};
  let inserted = 0;
  for (const def of defs) {
    const existed = await findOne(db, categories, eq(categories.name, def.name));
    const row = await upsertByUnique(db, categories, categories.name, def.name, {
      name: def.name,
      description: def.description,
      isActive: true,
      createdBy: adminId,
    });
    if (row) result[def.name] = row;
    if (!existed) inserted++;
  }
  log.ok(`categories (${inserted} new)`);
  return result;
}

async function seedProducts(db, catMap, adminId) {
  const defs = [
    { sku: 'SKU-1001', name: 'iPhone 15 Pro', cat: 'هواتف ذكية', cost: 1000, price: 1200, stockProfile: 'normal' },
    { sku: 'SKU-1002', name: 'Samsung S24 Ultra', cat: 'هواتف ذكية', cost: 950, price: 1150, stockProfile: 'normal' },
    { sku: 'SKU-1003', name: 'Xiaomi 14', cat: 'هواتف ذكية', cost: 400, price: 520, stockProfile: 'low' },
    { sku: 'SKU-1010', name: 'MacBook Air M2', cat: 'حواسيب محمولة', cost: 900, price: 1100, stockProfile: 'normal' },
    { sku: 'SKU-1011', name: 'Dell XPS 15', cat: 'حواسيب محمولة', cost: 1100, price: 1300, stockProfile: 'low' },
    { sku: 'SKU-1020', name: 'AirPods Pro 2', cat: 'إكسسوارات', cost: 180, price: 250, stockProfile: 'normal' },
    { sku: 'SKU-1021', name: 'شاحن Samsung 45W', cat: 'إكسسوارات', cost: 20, price: 40, stockProfile: 'zero' },
    { sku: 'SKU-1022', name: 'كفر iPhone 15', cat: 'إكسسوارات', cost: 5, price: 15, stockProfile: 'normal' },
    { sku: 'SKU-1030', name: 'خلاط Philips', cat: 'أجهزة منزلية', cost: 50, price: 80, stockProfile: 'normal' },
    { sku: 'SKU-1031', name: 'مكنسة Panasonic', cat: 'أجهزة منزلية', cost: 85, price: 120, stockProfile: 'low' },
    { sku: 'SKU-1040', name: 'رز بسمتي 10كغ', cat: 'مواد غذائية', cost: 12, price: 18, stockProfile: 'normal' },
    { sku: 'SKU-1041', name: 'زيت دوار الشمس 1لتر', cat: 'مواد غذائية', cost: 2, price: 3, stockProfile: 'zero' },
  ];
  const result = {};
  let inserted = 0;
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const cat = catMap[def.cat];
    const existing = await findOne(db, products, eq(products.sku, def.sku));
    if (existing) {
      result[def.sku] = { ...existing, _profile: def.stockProfile };
      continue;
    }
    const [row] = await db
      .insert(products)
      .values({
        name: def.name,
        sku: def.sku,
        barcode: String(100000000000 + i),
        categoryId: cat?.id || null,
        description: `وصف المنتج: ${def.name}`,
        costPrice: D(def.cost),
        sellingPrice: D(def.price),
        currency: 'USD',
        stock: 0,
        minStock: 5,
        unit: 'piece',
        status: 'available',
        lowStockThreshold: 10,
        isActive: true,
        createdBy: adminId,
      })
      .returning();
    result[def.sku] = { ...row, _profile: def.stockProfile };
    inserted++;
  }
  log.ok(`products (${inserted} new)`);
  return result;
}

function quantityForProfile(profile, warehouseRole) {
  if (warehouseRole === 'primary') {
    if (profile === 'zero') return 0;
    if (profile === 'low') return 3;
    return 60;
  }
  if (warehouseRole === 'secondary') {
    if (profile === 'zero') return 0;
    if (profile === 'low') return 2;
    return 25;
  }
  if (warehouseRole === 'remote') {
    if (profile === 'zero') return 0;
    if (profile === 'low') return 4;
    return 35;
  }
  return 0;
}

async function distributeStock(db, productMap, warehouseMap, adminId) {
  const distribution = [
    { warehouse: 'المخزن الرئيسي', role: 'primary' },
    { warehouse: 'مخزن الفرع الرئيسي - الإكسسوارات', role: 'secondary' },
    { warehouse: 'مخزن البصرة', role: 'remote' },
    { warehouse: 'مخزن أربيل', role: 'remote' },
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
      const qty = quantityForProfile(product._profile, dist.role);
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
          notes: 'Opening balance from deterministic seed',
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

async function seedCustomers(db, adminId) {
  const defs = [
    { name: 'عميل نقدي', phone: null, address: null, city: null, notes: 'الحساب النقدي الافتراضي' },
    { name: 'أحمد علي', phone: '07701234567', address: 'بغداد - الكرادة', city: 'بغداد', notes: null },
    { name: 'سارة حسن', phone: '07812345678', address: 'بغداد - المنصور', city: 'بغداد', notes: null },
    { name: 'محمد رضا', phone: '07901234567', address: 'بغداد - الأعظمية', city: 'بغداد', notes: 'مفضل للأقساط' },
    { name: 'حيدر الجبوري', phone: '07801234567', address: 'بغداد - الشعب', city: 'بغداد', notes: 'مفضل للأقساط' },
    { name: 'نور الدين', phone: '07912345678', address: 'البصرة - العشار', city: 'البصرة', notes: null },
    { name: 'مريم العبيدي', phone: '07951234567', address: 'أربيل - عينكاوة', city: 'أربيل', notes: null },
  ];
  const result = {};
  let inserted = 0;
  for (const def of defs) {
    const existing = (await db.select().from(customers).where(eq(customers.name, def.name)).limit(1))[0];
    if (existing) {
      result[def.name] = existing;
      continue;
    }
    const [row] = await db
      .insert(customers)
      .values({ ...def, isActive: true, createdBy: adminId })
      .returning();
    result[def.name] = row;
    inserted++;
  }
  log.ok(`customers (${inserted} new)`);
  return result;
}

// ── Sales / payments / installments / drafts ──────────────────────────────
async function ensureSalesScenarios(db, ctx) {
  const { products: productMap, customers: customerMap, branches: branchMap, warehouses: warehouseMap, users: userMap } = ctx;
  const cashier = userMap['sales'] || userMap['admin'];
  const adminId = userMap['admin']?.id;
  const main = branchMap['الفرع الرئيسي'];
  const mainWh = warehouseMap['المخزن الرئيسي'];
  const cashCustomer = customerMap['عميل نقدي'];
  const installmentCustomerA = customerMap['محمد رضا'];
  const installmentCustomerB = customerMap['حيدر الجبوري'];

  if (!main || !mainWh || !cashCustomer || !installmentCustomerA) {
    log.warn('sales scenarios skipped — missing prerequisites');
    return;
  }

  const scenarios = [
    {
      invoiceNumber: 'SEED-CASH-COMPLETED-0001',
      customer: cashCustomer,
      paymentType: 'cash',
      saleType: 'CASH',
      saleSource: 'POS',
      status: 'completed',
      createdAt: dateAt(2026, 1, 5),
      lines: [
        { sku: 'SKU-1020', qty: 1, unitPrice: 250 },
        { sku: 'SKU-1022', qty: 2, unitPrice: 15 },
      ],
      payments: [{ amount: 280, method: 'cash', note: 'دفع نقدي كامل' }],
      installments: null,
    },
    {
      invoiceNumber: 'SEED-CASH-PARTIAL-0002',
      customer: customerMap['أحمد علي'],
      paymentType: 'cash',
      saleType: 'CASH',
      saleSource: 'POS',
      status: 'pending',
      createdAt: dateAt(2026, 1, 10),
      lines: [{ sku: 'SKU-1010', qty: 1, unitPrice: 1100 }],
      payments: [{ amount: 600, method: 'cash', note: 'دفع جزئي' }],
      installments: null,
    },
    {
      invoiceNumber: 'SEED-INST-ACTIVE-0003',
      customer: installmentCustomerA,
      paymentType: 'installment',
      saleType: 'INSTALLMENT',
      saleSource: 'NEW_SALE',
      status: 'active',
      createdAt: dateAt(2026, 1, 1),
      lines: [{ sku: 'SKU-1001', qty: 1, unitPrice: 1200 }],
      payments: [{ amount: 400, method: 'cash', note: 'دفعة أولى' }],
      installments: {
        count: 4,
        firstDue: dateAt(2026, 2, 1),
        paidThrough: 1,
      },
    },
    {
      invoiceNumber: 'SEED-INST-COMPLETED-0004',
      customer: installmentCustomerB,
      paymentType: 'installment',
      saleType: 'INSTALLMENT',
      saleSource: 'NEW_SALE',
      status: 'completed',
      createdAt: dateAt(2025, 10, 1),
      lines: [{ sku: 'SKU-1011', qty: 1, unitPrice: 1300 }],
      payments: [{ amount: 500, method: 'cash', note: 'دفعة أولى' }],
      installments: {
        count: 4,
        firstDue: dateAt(2025, 11, 1),
        paidThrough: 4,
      },
    },
    {
      invoiceNumber: 'SEED-DRAFT-CASH-0005',
      customer: customerMap['سارة حسن'],
      paymentType: 'cash',
      saleType: 'CASH',
      saleSource: 'POS',
      status: 'draft',
      createdAt: dateAt(2026, 1, 12),
      lines: [{ sku: 'SKU-1030', qty: 1, unitPrice: 80 }],
      payments: [],
      installments: null,
    },
    {
      invoiceNumber: 'SEED-DRAFT-INST-0006',
      customer: installmentCustomerA,
      paymentType: 'installment',
      saleType: 'INSTALLMENT',
      saleSource: 'NEW_SALE',
      status: 'draft',
      createdAt: dateAt(2026, 1, 13),
      lines: [{ sku: 'SKU-1002', qty: 1, unitPrice: 1150 }],
      payments: [],
      installments: null,
    },
  ];

  for (const scenario of scenarios) {
    await applySaleScenario(db, scenario, {
      branchId: main.id,
      warehouseId: mainWh.id,
      productMap,
      cashierId: cashier?.id || adminId,
      adminId,
    });
  }
  log.ok(`sales scenarios (${scenarios.length} ensured)`);
}

async function applySaleScenario(db, scenario, ctx) {
  const existing = await findOne(db, sales, eq(sales.invoiceNumber, scenario.invoiceNumber));
  if (existing) return existing;

  const subtotal = scenario.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  const total = subtotal;
  const paid = scenario.payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = Math.max(0, total - paid);
  const installmentsRemainingValue = scenario.installments
    ? Number((total - paid).toFixed(2))
    : remaining;

  return await db.transaction(async (tx) => {
    const [sale] = await tx
      .insert(sales)
      .values({
        invoiceNumber: scenario.invoiceNumber,
        customerId: scenario.customer.id,
        branchId: ctx.branchId,
        warehouseId: ctx.warehouseId,
        subtotal: D(subtotal),
        discount: '0',
        tax: '0',
        total: D(total),
        currency: 'USD',
        exchangeRate: '1',
        interestRate: '0',
        interestAmount: '0',
        paymentType: scenario.paymentType,
        saleSource: scenario.saleSource,
        saleType: scenario.saleType,
        paidAmount: D(paid),
        remainingAmount: D(installmentsRemainingValue),
        status: scenario.status,
        notes: 'Deterministic seed scenario',
        createdAt: scenario.createdAt,
        updatedAt: scenario.createdAt,
        createdBy: ctx.cashierId || ctx.adminId,
      })
      .returning();

    const itemRows = scenario.lines.map((line) => {
      const product = ctx.productMap[line.sku];
      if (!product) {
        throw new Error(`Seed scenario references unknown SKU: ${line.sku}`);
      }
      return {
        saleId: sale.id,
        productId: product.id,
        productName: product.name,
        quantity: line.qty,
        unitPrice: D(line.unitPrice),
        discount: '0',
        subtotal: D(line.qty * line.unitPrice),
        createdAt: scenario.createdAt,
      };
    });
    if (itemRows.length) {
      await tx.insert(saleItems).values(itemRows);
    }

    for (const pay of scenario.payments) {
      await tx.insert(payments).values({
        saleId: sale.id,
        customerId: scenario.customer.id,
        amount: D(pay.amount),
        currency: 'USD',
        exchangeRate: '1',
        paymentMethod: pay.method,
        paymentReference: pay.reference || null,
        paymentDate: scenario.createdAt,
        notes: pay.note || null,
        createdAt: scenario.createdAt,
        createdBy: ctx.cashierId || ctx.adminId,
      });
    }

    if (scenario.installments) {
      const { count, firstDue, paidThrough } = scenario.installments;
      const remainingForInstallments = Number((total - scenario.payments.reduce((s, p) => s + p.amount, 0)).toFixed(2));
      const perInstallment = Number((remainingForInstallments / count).toFixed(2));
      let runningPaid = scenario.payments.reduce((s, p) => s + p.amount, 0);

      for (let k = 1; k <= count; k++) {
        const dueDate = new Date(firstDue);
        dueDate.setUTCMonth(dueDate.getUTCMonth() + (k - 1));
        const isPaid = k <= paidThrough;
        const amountThisInstallment =
          k === count
            ? Number((remainingForInstallments - perInstallment * (count - 1)).toFixed(2))
            : perInstallment;

        await tx.insert(installments).values({
          saleId: sale.id,
          customerId: scenario.customer.id,
          installmentNumber: k,
          dueAmount: D(amountThisInstallment),
          paidAmount: isPaid ? D(amountThisInstallment) : '0',
          remainingAmount: isPaid ? '0' : D(amountThisInstallment),
          currency: 'USD',
          dueDate: fmtDate(dueDate),
          paidDate: isPaid ? fmtDate(dueDate) : null,
          status: isPaid ? 'paid' : 'pending',
          notes: null,
          createdAt: scenario.createdAt,
          updatedAt: scenario.createdAt,
          createdBy: ctx.cashierId || ctx.adminId,
        });

        if (isPaid) {
          runningPaid += amountThisInstallment;
          await tx.insert(payments).values({
            saleId: sale.id,
            customerId: scenario.customer.id,
            amount: D(amountThisInstallment),
            currency: 'USD',
            exchangeRate: '1',
            paymentMethod: 'cash',
            paymentReference: null,
            paymentDate: dueDate,
            notes: `قسط رقم ${k}`,
            createdAt: dueDate,
            createdBy: ctx.cashierId || ctx.adminId,
          });
        }
      }

      const newRemaining = Math.max(0, Number((total - runningPaid).toFixed(2)));
      await tx
        .update(sales)
        .set({
          paidAmount: D(runningPaid),
          remainingAmount: D(newRemaining),
          status: newRemaining < 0.01 ? 'completed' : scenario.status,
        })
        .where(eq(sales.id, sale.id));
    }

    return sale;
  });
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
    details: JSON.stringify({ at: new Date().toISOString(), mode: MODE_DEMO ? 'demo' : 'base' }),
    ipAddress: '127.0.0.1',
  });
  log.ok('audit_log starter');
}

// ── Reset helpers ─────────────────────────────────────────────────────────
const TRUNCATE_ORDER = [
  'audit_log',
  'stock_movements',
  'warehouse_transfers',
  'product_stock',
  'installments',
  'payments',
  'sale_items',
  'sales',
  'products',
  'categories',
  'customers',
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

  if (MODE_DEMO || MODE_RESET) {
    log.info('seeding demo sales / installments / drafts...');
    await ensureSalesScenarios(db, {
      products: productMap,
      customers: customerMap,
      branches: branchMap,
      warehouses: warehouseMap,
      users: userMap,
    });
  } else {
    log.skip('demo sales skipped (use --demo or seed:demo)');
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
