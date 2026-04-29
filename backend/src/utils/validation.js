import { z } from 'zod';
import {
  SALE_SOURCES,
  SALE_SOURCE_POS,
  SALE_SOURCE_NEW_SALE,
  SALE_TYPES,
  SALE_TYPE_CASH,
  SALE_TYPE_INSTALLMENT,
  POS_PAYMENT_METHODS,
  PAYMENT_METHOD_CARD,
} from '../constants/sales.js';

/**
 * Validation schemas using Zod
 * These schemas validate incoming request data
 */

// User schemas
export const userSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username cannot exceed 50 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  phone: z.string().optional(),
  role: z
    .enum(['admin', 'global_admin', 'branch_admin', 'branch_manager', 'cashier', 'manager', 'viewer'])
    .default('cashier'),
  assignedBranchId: z
    .union([z.number().int().positive(), z.null()])
    .optional(),
  assignedWarehouseId: z
    .union([z.number().int().positive(), z.null()])
    .optional(),
});

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  totpCode: z.string().length(6).optional(),
});

// Customer schemas
export const customerSchema = z.object({
  name: z.string().min(2, 'Customer name must be at least 2 characters'),
  phone: z.string().min(1, 'Phone number is required'),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// Product schemas
//
// Stock quantity is intentionally NOT part of this schema. All stock changes
// must go through the inventory movement endpoints (`/inventory/adjust`,
// `/inventory/transfer`, sales flow). The product controller rejects any
// payload that tries to set quantity-like fields with the explicit
// `STOCK_UPDATE_NOT_ALLOWED_ON_PRODUCT` error code.
export const productSchema = z.object({
  name: z.string().min(2, 'Product name must be at least 2 characters'),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  categoryId: z.number().int().positive().optional(),
  description: z.string().optional(),
  costPrice: z.coerce.number().positive('Cost price must be positive'),
  sellingPrice: z.coerce.number().positive('Selling price must be positive'),
  currency: z.enum(['USD', 'IQD'], {
    errorMap: () => ({ message: 'Currency must be USD or IQD' }),
  }),
  // minStock / lowStockThreshold are alert thresholds, not stock balances —
  // they describe the product, so they stay on the product form.
  minStock: z.number().int().nonnegative().optional(),
  lowStockThreshold: z.number().int().nonnegative().optional(),
  unit: z.string().optional(),
  supplier: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  status: z.enum(['available', 'out_of_stock', 'discontinued']).optional(),
});

// Quantity-like keys that must never be accepted on product create/update.
// Detected at the controller layer so we can return the documented code
// `STOCK_UPDATE_NOT_ALLOWED_ON_PRODUCT` instead of a generic Zod error.
export const PRODUCT_FORBIDDEN_STOCK_KEYS = [
  'stock',
  'quantity',
  'qty',
  'stockQuantity',
  'currentStock',
  'inStock',
  'openingStock',
  'openingWarehouseId',
];

// ── Inventory schemas ─────────────────────────────────────────────────────
export const branchSchema = z.object({
  name: z.string().min(2, 'Branch name must be at least 2 characters'),
  address: z.string().optional(),
  // Default warehouse for this branch. The service layer additionally checks
  // that the warehouse belongs to this branch.
  defaultWarehouseId: z
    .union([z.number().int().positive(), z.null()])
    .optional(),
  isActive: z.boolean().optional(),
});

// `branchId` is required only when the multi-branch feature is enabled. With
// the feature off, warehouses are global. The service layer enforces this
// with the live feature flag.
export const warehouseSchema = z.object({
  name: z.string().min(2, 'Warehouse name must be at least 2 characters'),
  branchId: z
    .union([z.number().int().positive(), z.null()])
    .optional(),
  isActive: z.boolean().optional(),
});

export const stockAdjustmentSchema = z.object({
  productId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  quantityChange: z
    .number()
    .int()
    .refine((v) => v !== 0, 'Quantity change cannot be zero'),
  reason: z.string().min(2, 'Reason is required'),
  allowNegative: z.boolean().optional(),
});

export const stockTransferSchema = z
  .object({
    fromWarehouseId: z.number().int().positive(),
    toWarehouseId: z.number().int().positive(),
    productId: z.number().int().positive(),
    quantity: z.number().int().positive(),
    notes: z.string().nullable().optional(),
  })
  .refine((d) => d.fromWarehouseId !== d.toWarehouseId, {
    message: 'Source and destination warehouses must be different',
    path: ['toWarehouseId'],
  });

// Category schemas
export const categorySchema = z.object({
  name: z.string().min(2, 'Category name must be at least 2 characters'),
  description: z.string().optional(),
});

// Sale schemas
export const saleItemSchema = z.object({
  productId: z.number().int().positive('Product ID must be a positive integer'),
  quantity: z.number().int().positive('Quantity must be at least 1'),
  unitPrice: z.coerce.number().positive('Unit price must be positive'),
  discount: z.coerce.number().nonnegative('Discount cannot be negative').optional(),
});

export const saleSchema = z
  .object({
    customerId: z.union([z.number().int().positive(), z.null()]).optional(),
    branchId: z.number().int().positive().optional(),
    warehouseId: z.number().int().positive().optional(),
    currency: z.enum(['USD', 'IQD'], {
      errorMap: () => ({ message: 'Currency must be USD or IQD' }),
    }),
    exchangeRate: z.number().positive().optional(),
    items: z
      .array(saleItemSchema)
      .min(1, 'Sale must have at least one item')
      .refine((items) => items.length > 0, {
        message: 'Sale cannot have empty items',
      }),
    discount: z.number().nonnegative('Discount cannot be negative').optional().default(0),
    tax: z
      .number()
      .nonnegative('Tax cannot be negative')
      .max(100, 'Tax cannot exceed 100%')
      .optional()
      .default(0),
    // `paymentType` is the legacy column kept for backwards compatibility with
    // the sales table. Clients should send `saleType` instead; we accept either.
    paymentType: z.enum(['cash', 'installment', 'mixed']).optional(),
    saleSource: z.enum(SALE_SOURCES, {
      errorMap: () => ({ message: 'saleSource must be POS or NEW_SALE' }),
    }),
    saleType: z.enum(SALE_TYPES, {
      errorMap: () => ({ message: 'saleType must be CASH or INSTALLMENT' }),
    }),
    paymentMethod: z.enum(POS_PAYMENT_METHODS).optional(),
    paymentReference: z
      .string()
      .trim()
      .min(1, 'Card reference cannot be empty')
      .max(120, 'Card reference is too long')
      .optional()
      .nullable(),
    paidAmount: z.number().nonnegative('Paid amount cannot be negative').optional().default(0),
    installmentCount: z.number().int().positive('Installment count must be at least 1').optional(),
    notes: z.string().nullable().optional(),
    paymentNotes: z.string().nullable().optional(),
    interestRate: z
      .number()
      .nonnegative('Interest rate cannot be negative')
      .max(100, 'Interest rate cannot exceed 100%')
      .optional()
      .default(0),
    interestAmount: z.number().nonnegative().optional(),
  })
  .superRefine((data, ctx) => {
    // ── POS-originated sales: cash/card only, no deferred balance ───────────
    if (data.saleSource === SALE_SOURCE_POS) {
      if (data.saleType !== SALE_TYPE_CASH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['saleType'],
          message: 'POS supports cash/card sales only.',
        });
      }
      if (data.paymentMethod && !POS_PAYMENT_METHODS.includes(data.paymentMethod)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentMethod'],
          message: 'POS supports cash/card sales only.',
        });
      }
      if (data.installmentCount && data.installmentCount > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['installmentCount'],
          message: 'Installment sales must be created from NewSale.',
        });
      }
    }

    // ── NewSale: installments only ──────────────────────────────────────────
    if (data.saleSource === SALE_SOURCE_NEW_SALE) {
      if (data.saleType !== SALE_TYPE_INSTALLMENT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['saleType'],
          message: 'NewSale accepts installment sales only.',
        });
      }
      if (!data.customerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['customerId'],
          message: 'Customer is required for installment sales.',
        });
      }
    }

    // ── Card payments must carry a non-empty reference ──────────────────────
    if (data.paymentMethod === PAYMENT_METHOD_CARD) {
      const ref = typeof data.paymentReference === 'string' ? data.paymentReference.trim() : '';
      if (!ref) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentReference'],
          message: 'Card reference number is required.',
        });
      }
    }
  });
// Payment schemas
export const paymentSchema = z.object({
  saleId: z.number().int().positive().optional(),
  customerId: z.number().int().positive().optional(),
  amount: z.number().positive('Payment amount must be positive'),
  currency: z.enum(['USD', 'IQD']),
  exchangeRate: z.number().positive('Exchange rate must be positive'),
  paymentMethod: z.enum(POS_PAYMENT_METHODS),
  paymentReference: z
    .string()
    .trim()
    .min(1, 'Card reference cannot be empty')
    .max(120, 'Card reference is too long')
    .optional()
    .nullable(),
  notes: z.string().nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.paymentMethod === PAYMENT_METHOD_CARD) {
    const ref = typeof data.paymentReference === 'string' ? data.paymentReference.trim() : '';
    if (!ref) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['paymentReference'],
        message: 'Card reference number is required.',
      });
    }
  }
});

// Installment schemas
export const installmentSchema = z.object({
  saleId: z.number().int().positive(),
  customerId: z.number().int().positive(),
  installmentNumber: z.number().int().positive(),
  dueAmount: z.number().positive('Due amount must be positive'),
  currency: z.enum(['USD', 'IQD']),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  notes: z.string().nullable().optional(),
});

// Query schemas
export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100, 'Limit cannot exceed 100').default(10),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const settingsSchema = z.object({
  key: z.string().min(1, 'Settings key is required'),
  value: z.any(),
});

// ── Cash session / shift closing schemas ──────────────────────────────────
export const openCashSessionSchema = z.object({
  openingCash: z
    .number({ invalid_type_error: 'Opening cash must be a number' })
    .nonnegative('Opening cash cannot be negative')
    .default(0),
  currency: z.enum(['USD', 'IQD']).default('USD'),
  notes: z.string().nullable().optional(),
  // branchId is only honoured for global admins; the service falls back to
  // the user's assigned branch otherwise.
  branchId: z.number().int().positive().nullable().optional(),
});

export const closeCashSessionSchema = z.object({
  closingCash: z
    .number({ invalid_type_error: 'Closing cash must be a number' })
    .nonnegative('Closing cash cannot be negative'),
  notes: z.string().nullable().optional(),
});

