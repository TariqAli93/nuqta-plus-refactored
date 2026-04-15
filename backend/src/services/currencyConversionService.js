import { getDb } from '../db.js';
import { currencySettings } from '../models/index.js';
import { eq } from 'drizzle-orm';
import { ValidationError, NotFoundError } from '../utils/errors.js';

/**
 * Currency Conversion Service
 * Handles all currency conversion operations
 * Supports multiple currencies with dynamic exchange rates
 */
export class CurrencyConversionService {
  /**
   * Get exchange rate between two currencies
   * @param {string} fromCurrency - Source currency code (e.g., 'USD', 'IQD')
   * @param {string} toCurrency - Target currency code
   * @returns {Promise<number>} Exchange rate
   * @throws {ValidationError} If currency codes are invalid
   * @throws {NotFoundError} If currency is not found in database
   */
  async getExchangeRate(fromCurrency, toCurrency) {
    const db = await getDb();
    // Validate input
    if (!fromCurrency || !toCurrency) {
      throw new ValidationError('Both fromCurrency and toCurrency are required');
    }

    // Same currency, no conversion needed
    if (fromCurrency === toCurrency) {
      return 1;
    }

    // Get currency data from database
    const [fromCurrencyData] = await db
      .select()
      .from(currencySettings)
      .where(eq(currencySettings.currencyCode, fromCurrency))
      .limit(1);

    const [toCurrencyData] = await db
      .select()
      .from(currencySettings)
      .where(eq(currencySettings.currencyCode, toCurrency))
      .limit(1);

    if (!fromCurrencyData) {
      throw new NotFoundError(`Currency '${fromCurrency}'`);
    }

    if (!toCurrencyData) {
      throw new NotFoundError(`Currency '${toCurrency}'`);
    }

    // Check if currencies are active
    if (!fromCurrencyData.isActive || !toCurrencyData.isActive) {
      throw new ValidationError('One or both currencies are not active');
    }

    // Calculate exchange rate using cross-rate formula
    // Rate = targetRate / sourceRate
    const rate = toCurrencyData.exchangeRate / fromCurrencyData.exchangeRate;

    return parseFloat(rate.toFixed(6));
  }

  /**
   * Convert amount from one currency to another
   * @param {number} amount - Amount to convert
   * @param {string} fromCurrency - Source currency
   * @param {string} toCurrency - Target currency
   * @returns {Promise<number>} Converted amount
   * @throws {ValidationError} If amount is invalid
   */
  async convertAmount(amount, fromCurrency, toCurrency) {
    if (typeof amount !== 'number' || amount < 0) {
      throw new ValidationError('Amount must be a non-negative number');
    }

    const rate = await this.getExchangeRate(fromCurrency, toCurrency);
    const convertedAmount = amount * rate;

    return parseFloat(convertedAmount.toFixed(2));
  }

  /**
   * Convert multiple amounts at once (batch conversion)
   * @param {Array<number>} amounts - Array of amounts to convert
   * @param {string} fromCurrency - Source currency
   * @param {string} toCurrency - Target currency
   * @returns {Promise<Array<number>>} Array of converted amounts
   */
  async convertMultipleAmounts(amounts, fromCurrency, toCurrency) {
    if (!Array.isArray(amounts)) {
      throw new ValidationError('Amounts must be an array');
    }

    const rate = await this.getExchangeRate(fromCurrency, toCurrency);

    return amounts.map((amount) => {
      if (typeof amount !== 'number' || amount < 0) {
        throw new ValidationError('All amounts must be non-negative numbers');
      }
      return parseFloat((amount * rate).toFixed(2));
    });
  }

  /**
   * Get all exchange rates for a specific base currency
   * @param {string} baseCurrency - Base currency code
   * @returns {Promise<Object>} Object with currency codes as keys and rates as values
   */
  async getAllRatesForCurrency(baseCurrency) {
    const db = await getDb();
    const currencies = await db.select().from(currencySettings).all();

    const rates = {};
    for (const currency of currencies) {
      if (currency.currencyCode === baseCurrency) {
        rates[currency.currencyCode] = 1;
      } else {
        rates[currency.currencyCode] = await this.getExchangeRate(
          baseCurrency,
          currency.currencyCode
        );
      }
    }

    return rates;
  }

  /**
   * Convert sale totals to target currency
   * تحويل إجماليات المبيعات إلى عملة مستهدفة
   */
  async convertSaleTotals(saleTotals, targetCurrency) {
    const converted = {};

    for (const [currency, totals] of Object.entries(saleTotals)) {
      const rate = await this.getExchangeRate(currency, targetCurrency);

      converted[currency] = {
        originalCurrency: currency,
        targetCurrency: targetCurrency,
        exchangeRate: rate,
        totalSales: parseFloat((totals.totalSales * rate).toFixed(2)),
        totalPaid: parseFloat((totals.totalPaid * rate).toFixed(2)),
        totalRemaining: parseFloat((totals.totalRemaining * rate).toFixed(2)),
        totalProfit: parseFloat((totals.totalProfit * rate).toFixed(2)),
        avgSale: parseFloat((totals.avgSale * rate).toFixed(2)),
        count: totals.count,
      };
    }

    return converted;
  }

  /**
   * Get currency symbol
   * الحصول على رمز العملة
   */
  async getCurrencySymbol(currencyCode) {
    const db = await getDb();
    const [currency] = await db
      .select()
      .from(currencySettings)
      .where(eq(currencySettings.currencyCode, currencyCode))
      .limit(1);

    return currency ? currency.symbol : currencyCode;
  }

  /**
   * Format amount with currency symbol
   * تنسيق المبلغ مع رمز العملة
   */
  async formatAmount(amount, currencyCode) {
    const symbol = await this.getCurrencySymbol(currencyCode);
    const formattedAmount = parseFloat(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return `${symbol} ${formattedAmount}`;
  }

  /**
   * Validate currency code
   * التحقق من صحة رمز العملة
   */
  async validateCurrency(currencyCode) {
    const db = await getDb();
    const [currency] = await db
      .select()
      .from(currencySettings)
      .where(eq(currencySettings.currencyCode, currencyCode))
      .limit(1);

    return !!currency && currency.isActive;
  }

  /**
   * Get active currencies list
   * الحصول على قائمة العملات النشطة
   */
  async getActiveCurrencies() {
    const db = await getDb();
    const currencies = await db
      .select()
      .from(currencySettings)
      .where(eq(currencySettings.isActive, 1))
      .all();

    return currencies.map((c) => ({
      code: c.currencyCode,
      name: c.currencyName,
      symbol: c.symbol,
      exchangeRate: c.exchangeRate,
      isBase: c.isBaseCurrency,
    }));
  }
}
