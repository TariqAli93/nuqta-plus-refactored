import { getDb } from '../db.js';
import { installments, products, customers, sales, productStock } from '../models/index.js';
import { eq, and, lte, sql } from 'drizzle-orm';

export class AlertService {
  /**
   * Get overdue installments (pending installments with dueDate < today)
   * @returns {Promise<Array>} Array of overdue installments
   */
  async getOverdueInstallments() {
    const db = await getDb();
    const today = new Date().toISOString().split('T')[0];

    const overdue = await db
      .select({
        id: installments.id,
        saleId: installments.saleId,
        customerId: installments.customerId,
        installmentNumber: installments.installmentNumber,
        dueAmount: installments.dueAmount,
        paidAmount: installments.paidAmount,
        remainingAmount: installments.remainingAmount,
        currency: installments.currency,
        dueDate: installments.dueDate,
        status: installments.status,
        customerName: customers.name,
        customerPhone: customers.phone,
        invoiceNumber: sales.invoiceNumber,
      })
      .from(installments)
      .leftJoin(customers, eq(installments.customerId, customers.id))
      .leftJoin(sales, eq(installments.saleId, sales.id))
      .where(and(eq(installments.status, 'pending'), lte(installments.dueDate, today)))
      .orderBy(installments.dueDate);

    return overdue;
  }

  /**
   * Get low stock products. Stock is aggregated across warehouses from
   * `product_stock` (the canonical source). A product is "low" when the
   * total > 0 but <= the configured threshold (lowStockThreshold, falling
   * back to minStock).
   * @returns {Promise<Array>} Array of low stock products
   */
  async getLowStockProducts() {
    const db = await getDb();
    const stockExpr = sql`COALESCE(SUM(${productStock.quantity}), 0)`;
    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        barcode: products.barcode,
        unit: products.unit,
        currency: products.currency,
        minStock: products.minStock,
        lowStockThreshold: products.lowStockThreshold,
        isActive: products.isActive,
        stock: stockExpr.as('stock'),
      })
      .from(products)
      .leftJoin(productStock, eq(productStock.productId, products.id))
      .where(eq(products.isActive, true))
      .groupBy(products.id)
      .orderBy(stockExpr);

    return rows
      .map((r) => ({ ...r, stock: Number(r.stock) || 0 }))
      .filter((r) => {
        const threshold =
          r.lowStockThreshold && r.lowStockThreshold > 0
            ? r.lowStockThreshold
            : r.minStock || 0;
        return r.stock > 0 && r.stock <= threshold;
      });
  }

  /**
   * Get out of stock products. Stock is aggregated across warehouses from
   * `product_stock`; a product is out of stock when the sum is 0 (or there
   * are no rows yet).
   * @returns {Promise<Array>} Array of out of stock products
   */
  async getOutOfStockProducts() {
    const db = await getDb();
    const stockExpr = sql`COALESCE(SUM(${productStock.quantity}), 0)`;
    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        barcode: products.barcode,
        unit: products.unit,
        currency: products.currency,
        isActive: products.isActive,
        stock: stockExpr.as('stock'),
      })
      .from(products)
      .leftJoin(productStock, eq(productStock.productId, products.id))
      .where(eq(products.isActive, true))
      .groupBy(products.id)
      .orderBy(products.name);

    return rows
      .map((r) => ({ ...r, stock: Number(r.stock) || 0 }))
      .filter((r) => r.stock === 0);
  }

  /**
   * Get all alerts with statistics
   * @returns {Promise<Object>} Object containing all alerts and counts
   */
  async getAllAlerts() {
    const [overdueInstallments, lowStockProducts, outOfStockProducts] = await Promise.all([
      this.getOverdueInstallments(),
      this.getLowStockProducts(),
      this.getOutOfStockProducts(),
    ]);

    return {
      overdueInstallments: {
        items: overdueInstallments,
        count: overdueInstallments.length,
        totalAmount: overdueInstallments.reduce(
          (sum, inst) => sum + (inst.remainingAmount || 0),
          0
        ),
      },
      lowStockProducts: {
        items: lowStockProducts,
        count: lowStockProducts.length,
      },
      outOfStockProducts: {
        items: outOfStockProducts,
        count: outOfStockProducts.length,
      },
      totalAlerts: overdueInstallments.length + lowStockProducts.length + outOfStockProducts.length,
    };
  }
}

export default new AlertService();
