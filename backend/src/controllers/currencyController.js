import * as currencyService from '../services/currencyService.js';
import { ValidationError } from '../utils/errors.js';

/**
 * Currency Controller
 * Handles HTTP requests for currency management
 */

/**
 * Get all currencies
 */
export async function getCurrencies(request, reply) {
  const currencies = await currencyService.list();
  reply.send({ data: currencies });
}

/**
 * Get currency by code
 */
export async function getCurrency(request, reply) {
  const { code } = request.params;
  const currency = await currencyService.getByCode(code);
  reply.send({ data: currency });
}

/**
 * Update exchange rate
 */
export async function updateExchangeRate(request, reply) {
  const { code } = request.params;
  const { exchangeRate } = request.body;
  const userId = request.user.id;

  if (!exchangeRate || exchangeRate <= 0) {
    throw new ValidationError('Invalid exchange rate');
  }

  const updated = await currencyService.updateExchangeRate(code, exchangeRate, userId);
  reply.send({
    message: 'Exchange rate updated successfully',
    data: updated,
  });
}

/**
 * Update currency settings
 */
export async function updateCurrency(request, reply) {
  const { code } = request.params;
  const data = request.body;
  const userId = request.user.id;

  const updated = await currencyService.update(code, data, userId);
  reply.send({
    message: 'Currency updated successfully',
    data: updated,
  });
}

/**
 * Get active currencies
 */
export async function getActiveCurrencies(request, reply) {
  const currencies = await currencyService.getActiveCurrencies();
  reply.send({ data: currencies });
}

/**
 * Get base currency
 */
export async function getBaseCurrency(request, reply) {
  const currency = await currencyService.getBaseCurrency();
  reply.send({ data: currency });
}
