import { z } from 'zod';

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
  role: z.enum(['admin', 'cashier', 'manager', 'viewer']).default('cashier'),
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
  address: z.string().optional(),
  city: z.string().optional(),
  notes: z.string().optional(),
});

// Product schemas
export const productSchema = z.object({
  name: z.string().min(2, 'Product name must be at least 2 characters'),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  categoryId: z.number().int().positive().optional(),
  description: z.string().optional(),
  costPrice: z.number().positive('Cost price must be positive'),
  sellingPrice: z.number().positive('Selling price must be positive'),
  currency: z.enum(['USD', 'IQD'], {
    errorMap: () => ({ message: 'Currency must be USD or IQD' }),
  }),
  stock: z.number().int().nonnegative('Stock cannot be negative'),
  minStock: z.number().int().nonnegative().optional(),
  unit: z.string().optional(),
  status: z.enum(['available', 'out_of_stock', 'discontinued']).optional(),
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
  unitPrice: z.number().positive('Unit price must be positive'),
  discount: z.number().nonnegative('Discount cannot be negative').optional(),
});

export const saleSchema = z.object({
  customerId: z.union([z.number().int().positive(), z.null()]).optional(),
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
  paymentType: z.enum(['cash', 'installment', 'mixed'], {
    errorMap: () => ({ message: 'Payment type must be cash, installment, or mixed' }),
  }),
  paymentMethod: z.enum(['cash', 'card', 'bank_transfer']).optional(),
  paidAmount: z.number().nonnegative('Paid amount cannot be negative').optional().default(0),
  installmentCount: z.number().int().positive('Installment count must be at least 1').optional(),
  notes: z.string().optional(),
  interestRate: z
    .number()
    .nonnegative('Interest rate cannot be negative')
    .max(100, 'Interest rate cannot exceed 100%')
    .optional()
    .default(0),
  interestAmount: z.number().nonnegative().optional(),
});
// Payment schemas
export const paymentSchema = z.object({
  saleId: z.number().int().positive().optional(),
  customerId: z.number().int().positive().optional(),
  amount: z.number().positive('Payment amount must be positive'),
  currency: z.enum(['USD', 'IQD']),
  exchangeRate: z.number().positive('Exchange rate must be positive'),
  paymentMethod: z.enum(['cash', 'card', 'bank_transfer']),
  notes: z.string().optional(),
});

// Installment schemas
export const installmentSchema = z.object({
  saleId: z.number().int().positive(),
  customerId: z.number().int().positive(),
  installmentNumber: z.number().int().positive(),
  dueAmount: z.number().positive('Due amount must be positive'),
  currency: z.enum(['USD', 'IQD']),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  notes: z.string().optional(),
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

