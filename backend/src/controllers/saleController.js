import { SaleService } from '../services/saleService.js';
import { saleSchema } from '../utils/validation.js';
import { CurrencyConversionService } from '../services/currencyConversionService.js';

const saleService = new SaleService();
const currencyService = new CurrencyConversionService();

export class SaleController {
  /**
   * Create a new sale
   */
  async create(request, reply) {
    const validatedData = saleSchema.parse(request.body);
    const sale = await saleService.create(validatedData, request.user.id);

    return reply.code(201).send({
      success: true,
      data: sale,
      message: 'Sale created successfully',
    });
  }

  /**
   * Get all sales with filters
   */
  async getAll(request, reply) {
    const result = await saleService.getAll(request.query);
    return reply.send({
      success: true,
      data: result.data,
      meta: result.meta,
    });
  }

  async getById(request, reply) {
    const sale = await saleService.getById(request.params.id);
    return reply.send({
      success: true,
      data: sale,
    });
  }

  async cancel(request, reply) {
    const sale = await saleService.cancel(request.params.id, request.user.id);
    return reply.send({
      success: true,
      data: sale,
      message: 'Sale cancelled successfully',
    });
  }

  async addPayment(request, reply) {
    const sale = await saleService.addPayment(request.params.saleId, request.body, request.user.id);
    return reply.send({
      success: true,
      data: sale,
      message: 'Payment added successfully',
    });
  }

  async getSalesReport(request, reply) {
    const report = await saleService.getSalesReport(request.query);
    return reply.send({
      success: true,
      data: report,
    });
  }

  async removePayment(request, reply) {
    const sale = await saleService.removePayment(
      request.params.saleId,
      request.params.paymentId,
      request.user.id
    );
    return reply.send({
      success: true,
      data: sale,
      message: 'Payment removed successfully',
    });
  }

  async getExchangeRates(request, reply) {
    const { baseCurrency } = request.query;
    const rates = await currencyService.getAllRatesForCurrency(baseCurrency || 'USD');
    return reply.send({
      success: true,
      data: rates,
    });
  }

  async convertAmount(request, reply) {
    const { amount, fromCurrency, toCurrency } = request.body;
    const convertedAmount = await currencyService.convertAmount(amount, fromCurrency, toCurrency);
    return reply.send({
      success: true,
      data: {
        originalAmount: amount,
        fromCurrency,
        toCurrency,
        convertedAmount,
        exchangeRate: await currencyService.getExchangeRate(fromCurrency, toCurrency),
      },
    });
  }

  async removeSale(request, reply) {
    const sale = await saleService.removeSale(request.params.id);
    return reply.send({
      success: true,
      data: sale,
      message: 'Sale removed successfully',
    });
  }

  async restoreSale(request, reply) {
    const sale = await saleService.restoreSale(request.params.id);
    return reply.send({
      success: true,
      data: sale,
      message: 'Sale restored successfully',
    });
  }

  async createDraft(request, reply) {
    const sale = await saleService.createDraft(request.body, request.user.id);
    return reply.code(201).send({
      success: true,
      data: sale,
      message: 'Draft saved successfully',
    });
  }

  async completeDraft(request, reply) {
    const validatedData = saleSchema.parse(request.body);
    const sale = await saleService.completeDraft(request.params.id, validatedData, request.user.id);
    return reply.send({
      success: true,
      data: sale,
      message: 'Draft completed successfully',
    });
  }

  async deleteOldDrafts(request, reply) {
    const deletedCount = await saleService.deleteOldDrafts();
    return reply.send({
      success: true,
      data: { deletedCount },
      message: `Deleted ${deletedCount} old draft(s)`,
    });
  }

  async getTopProducts(request, reply) {
    const topProducts = await saleService.getTopProducts(request.query);
    return reply.send({
      success: true,
      data: topProducts,
    });
  }
}
