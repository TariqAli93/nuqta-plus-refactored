import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Users Table
// Simplified RBAC: role is stored as text enum ('admin', 'cashier', 'manager', 'viewer')
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  role: text('role').notNull().default('cashier'), // 'admin', 'cashier', 'manager', 'viewer'
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  lastLoginAt: text('last_login_at'),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
});

// Customers Table
export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  phone: text('phone'),
  address: text('address'),
  city: text('city'),
  notes: text('notes'),
  totalPurchases: real('total_purchases').default(0),
  totalDebt: real('total_debt').default(0),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
  createdBy: integer('created_by').references(() => users.id),
});

// Categories Table
export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
  createdBy: integer('created_by').references(() => users.id),
});

// Products Table
export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  sku: text('sku').unique(),
  barcode: text('barcode'),
  categoryId: integer('category_id').references(() => categories.id),
  description: text('description'),
  costPrice: real('cost_price').notNull(),
  sellingPrice: real('selling_price').notNull(),
  currency: text('currency').notNull().default('USD'),
  stock: integer('stock').default(0),
  minStock: integer('min_stock').default(0),
  unit: text('unit').default('piece'),
  supplier: text('supplier'),
  status: text('status').notNull().default('available'), // available, out_of_stock, discontinued
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
  createdBy: integer('created_by').references(() => users.id),
});

// Sales Table
export const sales = sqliteTable('sales', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  invoiceNumber: text('invoice_number').notNull().unique(),
  customerId: integer('customer_id').references(() => customers.id),
  subtotal: real('subtotal').notNull(),
  discount: real('discount').default(0),
  tax: real('tax').default(0),
  total: real('total').notNull(),
  currency: text('currency').notNull().default('USD'),
  exchangeRate: real('exchange_rate').default(1),
  interestRate: real('interest_rate').default(0), // New field for interest rate
  interestAmount: real('interest_amount').default(0), // New field for interest amount
  paymentType: text('payment_type').notNull(), // 'cash', 'installment', 'mixed'
  paidAmount: real('paid_amount').default(0),
  remainingAmount: real('remaining_amount').default(0),
  status: text('status').notNull().default('pending'), // 'pending', 'completed', 'cancelled'
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
  createdBy: integer('created_by').references(() => users.id),
});

// Sale Items Table
export const saleItems = sqliteTable('sale_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  saleId: integer('sale_id')
    .notNull()
    .references(() => sales.id, { onDelete: 'cascade' }),
  productId: integer('product_id').references(() => products.id),
  productName: text('product_name').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: real('unit_price').notNull(),
  discount: real('discount').default(0),
  subtotal: real('subtotal').notNull(),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
});

// Payments Table
export const payments = sqliteTable('payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  saleId: integer('sale_id').references(() => sales.id, { onDelete: 'cascade' }),
  customerId: integer('customer_id').references(() => customers.id),
  amount: real('amount').notNull(),
  currency: text('currency').notNull().default('USD'),
  exchangeRate: real('exchange_rate').default(1),
  paymentMethod: text('payment_method').notNull(), // 'cash', 'card', 'bank_transfer'
  paymentDate: text('payment_date').default(sql`(datetime('now','localtime'))`),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  createdBy: integer('created_by').references(() => users.id),
});

// Installments Table
export const installments = sqliteTable('installments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  saleId: integer('sale_id').references(() => sales.id, { onDelete: 'cascade' }),
  customerId: integer('customer_id').references(() => customers.id),
  installmentNumber: integer('installment_number').notNull(),
  dueAmount: real('due_amount').notNull(),
  paidAmount: real('paid_amount').default(0),
  remainingAmount: real('remaining_amount').notNull(),
  currency: text('currency').notNull().default('IQD'),
  dueDate: text('due_date').notNull(),
  paidDate: text('paid_date'),
  status: text('status').notNull().default('pending'), // 'pending', 'paid', 'overdue', 'cancelled'
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
  createdBy: integer('created_by').references(() => users.id),
});

// Currency Settings Table
export const currencySettings = sqliteTable('currency_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  currencyCode: text('currency_code').notNull().unique(),
  currencyName: text('currency_name').notNull(),
  symbol: text('symbol').notNull(),
  exchangeRate: real('exchange_rate').notNull(),
  isBaseCurrency: integer('is_base_currency', { mode: 'boolean' }).default(false),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
});

// Settings Table
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  description: text('description'),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
  updatedBy: integer('updated_by').references(() => users.id),
});
