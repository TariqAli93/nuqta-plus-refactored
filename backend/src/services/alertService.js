import { getDb } from '../db.js';
import { installments, products, customers, sales } from '../models/index.js';
import { eq, and, lte, gt } from 'drizzle-orm';

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
   * Get low stock products (stock <= minStock and stock > 0)
   * @returns {Promise<Array>} Array of low stock products
   */
  async getLowStockProducts() {
    const db = await getDb();
    const lowStock = await db
      .select()
      .from(products)
      .where(
        and(
          lte(products.stock, products.minStock),
          gt(products.stock, 0),
          eq(products.isActive, true)
        )
      )
      .orderBy(products.stock);

    return lowStock;
  }

  /**
   * Get out of stock products (stock = 0)
   * @returns {Promise<Array>} Array of out of stock products
   */
  async getOutOfStockProducts() {
    const db = await getDb();
    const outOfStock = await db
      .select()
      .from(products)
      .where(and(eq(products.stock, 0), eq(products.isActive, true)))
      .orderBy(products.name);

    return outOfStock;
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
