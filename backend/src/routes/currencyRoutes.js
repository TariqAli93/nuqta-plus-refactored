import * as currencyController from '../controllers/currencyController.js';

/**
 * Currency Routes
 */
export default async function currencyRoutes(fastify) {
  // Get all currencies
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    handler: currencyController.getCurrencies,
  });

  // Get active currencies
  fastify.get('/active', {
    onRequest: [fastify.authenticate],
    handler: currencyController.getActiveCurrencies,
  });

  // Get base currency
  fastify.get('/base', {
    onRequest: [fastify.authenticate],
    handler: currencyController.getBaseCurrency,
  });

  // Get currency by code
  fastify.get('/:code', {
    onRequest: [fastify.authenticate],
    handler: currencyController.getCurrency,
  });

  // Update exchange rate
  fastify.patch('/:code/exchange-rate', {
    onRequest: [fastify.authenticate],
    handler: currencyController.updateExchangeRate,
  });

  // Update currency settings
  fastify.put('/:code', {
    onRequest: [fastify.authenticate],
    handler: currencyController.updateCurrency,
  });
}
