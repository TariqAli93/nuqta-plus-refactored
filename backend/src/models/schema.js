import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ── Users ─────────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  // Roles: 'admin' (legacy full), 'global_admin', 'branch_admin',
  //        'manager', 'cashier', 'viewer'
  role: text('role').notNull().default('cashier'),
  // Branch binding — NULL means "unassigned" (only valid for admin/global_admin)
  assignedBranchId: integer('assigned_branch_id'),
  assignedWarehouseId: integer('assigned_warehouse_id'),
  isActive: boolean('is_active').default(true),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ── Customers ─────────────────────────────────────────────────────────────
export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  address: text('address'),
  city: text('city'),
  notes: text('notes'),
  totalPurchases: numeric('total_purchases', { precision: 18, scale: 4 }).default('0'),
  totalDebt: numeric('total_debt', { precision: 18, scale: 4 }).default('0'),
  // Credit scoring (populated by daily creditScoringJob)
  creditScore: integer('credit_score'),
  creditScoreUpdatedAt: timestamp('credit_score_updated_at'),
  recommendedLimit: numeric('recommended_limit', { precision: 18, scale: 4 }),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdBy: integer('created_by').references(() => users.id),
});

// ── Categories ────────────────────────────────────────────────────────────
export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdBy: integer('created_by').references(() => users.id),
});

// ── Products ──────────────────────────────────────────────────────────────
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  sku: text('sku').unique(),
  barcode: text('barcode'),
  categoryId: integer('category_id').references(() => categories.id),
  description: text('description'),
  costPrice: numeric('cost_price', { precision: 18, scale: 4 }).notNull(),
  sellingPrice: numeric('selling_price', { precision: 18, scale: 4 }).notNull(),
  currency: text('currency').notNull().default('USD'),
  stock: integer('stock').default(0),
  minStock: integer('min_stock').default(0),
  unit: text('unit').default('piece'),
  supplier: text('supplier'),
  status: text('status').notNull().default('available'),
  // Inventory: per-warehouse low-stock threshold. Falls back to minStock when null.
  lowStockThreshold: integer('low_stock_threshold').default(0),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdBy: integer('created_by').references(() => users.id),
});

// ── Branches ──────────────────────────────────────────────────────────────
export const branches = pgTable('branches', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  address: text('address'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Warehouses ────────────────────────────────────────────────────────────
export const warehouses = pgTable('warehouses', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  branchId: integer('branch_id')
    .notNull()
    .references(() => branches.id),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Product Stock (per warehouse) ─────────────────────────────────────────
export const productStock = pgTable(
  'product_stock',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    warehouseId: integer('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(0),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    productWarehouseIdx: uniqueIndex('product_stock_product_warehouse_idx').on(
      t.productId,
      t.warehouseId
    ),
  })
);

// ── Stock Movements ───────────────────────────────────────────────────────
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    warehouseId: integer('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    // 'sale' | 'sale_cancel' | 'sale_return' | 'transfer_in' | 'transfer_out'
    //  | 'manual_adjustment_in' | 'manual_adjustment_out' | 'opening_balance'
    movementType: text('movement_type').notNull(),
    quantityChange: integer('quantity_change').notNull(),
    quantityBefore: integer('quantity_before').notNull(),
    quantityAfter: integer('quantity_after').notNull(),
    referenceType: text('reference_type'), // 'sale' | 'transfer' | 'adjustment' | null
    referenceId: integer('reference_id'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow(),
    createdBy: integer('created_by').references(() => users.id),
  },
  (t) => ({
    warehouseIdx: index('stock_movements_warehouse_idx').on(t.warehouseId),
    productIdx: index('stock_movements_product_idx').on(t.productId),
    createdAtIdx: index('stock_movements_created_at_idx').on(t.createdAt),
  })
);

// ── Warehouse Transfer Requests ───────────────────────────────────────────
// Approval-gated transfer between warehouses. Stock only moves when approved.
export const warehouseTransfers = pgTable(
  'warehouse_transfers',
  {
    id: serial('id').primaryKey(),
    branchId: integer('branch_id')
      .notNull()
      .references(() => branches.id),
    fromWarehouseId: integer('from_warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    toWarehouseId: integer('to_warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    quantity: integer('quantity').notNull(),
    status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
    requestedBy: integer('requested_by').references(() => users.id),
    approvedBy: integer('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    rejectionReason: text('rejection_reason'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    statusIdx: index('warehouse_transfers_status_idx').on(t.status),
    branchIdx: index('warehouse_transfers_branch_idx').on(t.branchId),
  })
);

// ── Sales ─────────────────────────────────────────────────────────────────
export const sales = pgTable('sales', {
  id: serial('id').primaryKey(),
  invoiceNumber: text('invoice_number').notNull().unique(),
  customerId: integer('customer_id').references(() => customers.id),
  branchId: integer('branch_id').references(() => branches.id),
  warehouseId: integer('warehouse_id').references(() => warehouses.id),
  subtotal: numeric('subtotal', { precision: 18, scale: 4 }).notNull(),
  discount: numeric('discount', { precision: 18, scale: 4 }).default('0'),
  tax: numeric('tax', { precision: 18, scale: 4 }).default('0'),
  total: numeric('total', { precision: 18, scale: 4 }).notNull(),
  currency: text('currency').notNull().default('USD'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).default('1'),
  interestRate: numeric('interest_rate', { precision: 8, scale: 4 }).default('0'),
  interestAmount: numeric('interest_amount', { precision: 18, scale: 4 }).default('0'),
  paymentType: text('payment_type').notNull(), // 'cash', 'installment', 'mixed' (legacy column)
  // ── v2 source/type fields ────────────────────────────────────────────────
  saleSource: text('sale_source'), // 'POS' | 'NEW_SALE'
  saleType: text('sale_type'),     // 'CASH' | 'INSTALLMENT'
  // ────────────────────────────────────────────────────────────────────────
  paidAmount: numeric('paid_amount', { precision: 18, scale: 4 }).default('0'),
  remainingAmount: numeric('remaining_amount', { precision: 18, scale: 4 }).default('0'),
  status: text('status').notNull().default('pending'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdBy: integer('created_by').references(() => users.id),
});

// ── Sale Items ────────────────────────────────────────────────────────────
export const saleItems = pgTable('sale_items', {
  id: serial('id').primaryKey(),
  saleId: integer('sale_id')
    .notNull()
    .references(() => sales.id, { onDelete: 'cascade' }),
  productId: integer('product_id').references(() => products.id),
  productName: text('product_name').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }).notNull(),
  discount: numeric('discount', { precision: 18, scale: 4 }).default('0'),
  subtotal: numeric('subtotal', { precision: 18, scale: 4 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Payments ──────────────────────────────────────────────────────────────
export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  saleId: integer('sale_id').references(() => sales.id, { onDelete: 'cascade' }),
  customerId: integer('customer_id').references(() => customers.id),
  amount: numeric('amount', { precision: 18, scale: 4 }).notNull(),
  currency: text('currency').notNull().default('USD'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).default('1'),
  paymentMethod: text('payment_method').notNull(),
  paymentReference: text('payment_reference'),
  paymentDate: timestamp('payment_date').defaultNow(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  createdBy: integer('created_by').references(() => users.id),
});

// ── Installments ──────────────────────────────────────────────────────────
export const installments = pgTable('installments', {
  id: serial('id').primaryKey(),
  saleId: integer('sale_id').references(() => sales.id, { onDelete: 'cascade' }),
  customerId: integer('customer_id').references(() => customers.id),
  installmentNumber: integer('installment_number').notNull(),
  dueAmount: numeric('due_amount', { precision: 18, scale: 4 }).notNull(),
  paidAmount: numeric('paid_amount', { precision: 18, scale: 4 }).default('0'),
  remainingAmount: numeric('remaining_amount', { precision: 18, scale: 4 }).notNull(),
  currency: text('currency').notNull().default('IQD'),
  dueDate: text('due_date').notNull(),
  paidDate: text('paid_date'),
  status: text('status').notNull().default('pending'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdBy: integer('created_by').references(() => users.id),
});

// ── Currency Settings ─────────────────────────────────────────────────────
export const currencySettings = pgTable('currency_settings', {
  id: serial('id').primaryKey(),
  currencyCode: text('currency_code').notNull().unique(),
  currencyName: text('currency_name').notNull(),
  symbol: text('symbol').notNull(),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull(),
  isBaseCurrency: boolean('is_base_currency').default(false),
  isActive: boolean('is_active').default(true),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ── Settings ──────────────────────────────────────────────────────────────
export const settings = pgTable('settings', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at').defaultNow(),
  updatedBy: integer('updated_by').references(() => users.id),
});

// ── Audit Log ─────────────────────────────────────────────────────────────
// New table for tracking all important user actions.
export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  username: text('username'),
  action: text('action').notNull(),        // e.g. 'sale:create', 'user:login', 'backup:create'
  resource: text('resource'),               // e.g. 'sales', 'users', 'products'
  resourceId: integer('resource_id'),       // ID of the affected record
  details: text('details'),                 // JSON string with extra context
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at').defaultNow(),
});
