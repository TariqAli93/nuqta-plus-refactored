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
  jsonb,
  date,
} from 'drizzle-orm/pg-core';

// ── Users ─────────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  // Roles: 'admin' (legacy full), 'global_admin', 'branch_admin',
  //        'branch_manager', 'manager', 'cashier', 'viewer'
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
  // Per-branch default warehouse — used to seed the active warehouse when the
  // user logs in or switches branches. Nullable so a brand-new branch can
  // exist before any warehouse is created. Cleared automatically (SET NULL)
  // if the referenced warehouse is deleted at the database level.
  defaultWarehouseId: integer('default_warehouse_id'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Warehouses ────────────────────────────────────────────────────────────
// `branchId` is nullable so warehouses can exist independently when the
// multi-branch feature is disabled. When the feature is enabled, the
// validation/service layer requires a branchId.
export const warehouses = pgTable('warehouses', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  branchId: integer('branch_id').references(() => branches.id),
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

// ── Credit Events ─────────────────────────────────────────────────────────
// Append-only history of every payment/installment lifecycle event used to
// rebuild credit features at any historical point in time. Snapshots are
// derived from this table — never the other way around.
//
// event_type allowed values:
//   PAYMENT   — installment paid (delay_days >= 0)
//   LATE      — installment paid after due date
//   MISSED    — installment overdue & still pending
//   CREATED   — installment sale opened
//   CLOSED    — installment sale fully paid / closed
//   DEFAULTED — manual default flag (admin or rule-engine)
export const creditEvents = pgTable(
  'credit_events',
  {
    id: serial('id').primaryKey(),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    saleId: integer('sale_id').references(() => sales.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    amount: numeric('amount', { precision: 18, scale: 4 }).default('0'),
    delayDays: integer('delay_days').default(0),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    customerIdx: index('credit_events_customer_idx').on(t.customerId),
    typeIdx: index('credit_events_type_idx').on(t.eventType),
    createdAtIdx: index('credit_events_created_at_idx').on(t.createdAt),
  })
);

// ── Credit Snapshots ──────────────────────────────────────────────────────
// Training dataset: one row per (customer_id, snapshot_date). Features must
// only contain information available BEFORE snapshot_date; the label is
// computed by looking forward `label_window_days` days. NEVER mix the two —
// any leakage invalidates the model.
export const creditSnapshots = pgTable(
  'credit_snapshots',
  {
    id: serial('id').primaryKey(),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    snapshotDate: date('snapshot_date').notNull(),
    totalSalesOnInstallment: integer('total_sales_on_installment').default(0),
    totalPaidOnTime: integer('total_paid_on_time').default(0),
    totalLatePayments: integer('total_late_payments').default(0),
    avgDelayDays: numeric('avg_delay_days', { precision: 10, scale: 4 }).default('0'),
    maxDelayDays: integer('max_delay_days').default(0),
    currentOutstandingDebt: numeric('current_outstanding_debt', {
      precision: 18,
      scale: 4,
    }).default('0'),
    activeInstallmentsCount: integer('active_installments_count').default(0),
    completedInstallmentsCount: integer('completed_installments_count').default(0),
    labelDefaulted: boolean('label_defaulted').default(false),
    labelWindowDays: integer('label_window_days').default(90),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    customerIdx: index('credit_snapshots_customer_idx').on(t.customerId),
    snapshotDateIdx: index('credit_snapshots_snapshot_date_idx').on(t.snapshotDate),
    labelIdx: index('credit_snapshots_label_idx').on(t.labelDefaulted),
    customerSnapshotIdx: uniqueIndex('credit_snapshots_customer_date_idx').on(
      t.customerId,
      t.snapshotDate
    ),
  })
);

// ── Credit Scores (inference log) ─────────────────────────────────────────
// One row per scoring call. Used for monitoring, audit, and offline drift /
// accuracy analysis. Never mutated — only inserted.
export const creditScores = pgTable(
  'credit_scores',
  {
    id: serial('id').primaryKey(),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    modelVersion: text('model_version').notNull(),
    riskProbability: numeric('risk_probability', { precision: 8, scale: 6 }).notNull(),
    riskLevel: text('risk_level').notNull(), // 'LOW' | 'MEDIUM' | 'HIGH'
    reasons: jsonb('reasons'),
    features: jsonb('features'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    customerIdx: index('credit_scores_customer_idx').on(t.customerId),
    createdAtIdx: index('credit_scores_created_at_idx').on(t.createdAt),
    versionIdx: index('credit_scores_version_idx').on(t.modelVersion),
  })
);

// ── Notification Settings ─────────────────────────────────────────────────
// Singleton row (id=1) holding the messaging-module configuration. The whole
// notification feature is OFF by default — no automatic message is queued or
// sent until an admin enables `enabled` from the Settings UI.
export const notificationSettings = pgTable('notification_settings', {
  id: serial('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  provider: text('provider').notNull().default('bulksmsiraq'),
  // Encrypted at rest using config.jwt.secret-derived key. Never returned to
  // the frontend except as a masked preview.
  apiKeyEncrypted: text('api_key_encrypted'),
  senderId: text('sender_id'),
  smsEnabled: boolean('sms_enabled').notNull().default(true),
  whatsappEnabled: boolean('whatsapp_enabled').notNull().default(false),
  autoFallbackEnabled: boolean('auto_fallback_enabled').notNull().default(true),
  defaultChannel: text('default_channel').notNull().default('auto'), // 'sms' | 'whatsapp' | 'auto'
  overdueReminderEnabled: boolean('overdue_reminder_enabled').notNull().default(true),
  paymentConfirmationEnabled: boolean('payment_confirmation_enabled').notNull().default(true),
  bulkMessagingEnabled: boolean('bulk_messaging_enabled').notNull().default(false),
  singleCustomerMessagingEnabled: boolean('single_customer_messaging_enabled')
    .notNull()
    .default(true),
  // Optional per-template body overrides. When NULL, the in-code defaults are used.
  templates: jsonb('templates'),
  lastTestAt: timestamp('last_test_at'),
  lastTestStatus: text('last_test_status'),
  lastTestMessage: text('last_test_message'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ── Notifications ─────────────────────────────────────────────────────────
// One row per outbound message. Status lifecycle:
//   pending → processing → (sent | failed)
// The queue worker picks rows where status='pending' AND next_attempt_at<=now.
// `dedupe_key` lets the service skip duplicates for the same logical event
// (e.g. one overdue reminder per installment per day).
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    type: text('type').notNull(), // 'overdue_reminder' | 'payment_confirmation' | 'bulk_message' | 'customer_message'
    channel: text('channel').notNull().default('auto'), // 'sms' | 'whatsapp' | 'auto'
    resolvedChannel: text('resolved_channel'),
    recipientPhone: text('recipient_phone').notNull(),
    customerId: integer('customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),
    saleId: integer('sale_id').references(() => sales.id, { onDelete: 'set null' }),
    installmentId: integer('installment_id').references(() => installments.id, {
      onDelete: 'set null',
    }),
    paymentId: integer('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    template: text('template'),
    payload: jsonb('payload'),
    messageBody: text('message_body').notNull(),
    status: text('status').notNull().default('pending'), // 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled'
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: timestamp('next_attempt_at').defaultNow(),
    dedupeKey: text('dedupe_key'),
    error: text('error'),
    sentAt: timestamp('sent_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    statusIdx: index('notifications_status_idx').on(t.status),
    nextAttemptIdx: index('notifications_next_attempt_idx').on(t.nextAttemptAt),
    customerIdx: index('notifications_customer_idx').on(t.customerId),
    typeIdx: index('notifications_type_idx').on(t.type),
    dedupeIdx: index('notifications_dedupe_idx').on(t.dedupeKey),
  })
);

// ── Notification Logs ─────────────────────────────────────────────────────
// Append-only audit trail of every provider call (success or failure). Kept
// separate from `notifications` so we have a complete history even after
// retries.
export const notificationLogs = pgTable(
  'notification_logs',
  {
    id: serial('id').primaryKey(),
    notificationId: integer('notification_id').references(() => notifications.id, {
      onDelete: 'cascade',
    }),
    provider: text('provider').notNull(),
    channel: text('channel').notNull(),
    requestPayload: jsonb('request_payload'),
    responsePayload: jsonb('response_payload'),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    notificationIdx: index('notification_logs_notification_idx').on(t.notificationId),
    createdAtIdx: index('notification_logs_created_at_idx').on(t.createdAt),
  })
);

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
