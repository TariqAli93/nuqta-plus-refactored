import { getDb, saveDatabase } from '../db.js';
import { currencySettings } from '../models/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Currency Service
 * Handles currency settings and exchange rate management
 */

/**
 * Get all currencies
 */
export async function list() {
  const db = await getDb();
  const currencies = await db.select().from(currencySettings).all();
  return currencies;
}

/**
 * Get currency by code
 */
export async function getByCode(currencyCode) {
  const db = await getDb();
  const currency = await db
    .select()
    .from(currencySettings)
    .where(eq(currencySettings.currencyCode, currencyCode))
    .get();

  if (!currency) {
    throw new Error('Currency not found');
  }

  return currency;
}

/**
 * Update exchange rate
 */
export async function updateExchangeRate(currencyCode, newRate, _userId) {
  const db = await getDb();
  const currency = await db
    .select()
    .from(currencySettings)
    .where(eq(currencySettings.currencyCode, currencyCode))
    .get();

  if (!currency) {
    throw new Error('Currency not found');
  }

  if (currency.isBaseCurrency) {
    throw new Error('Cannot update exchange rate for base currency');
  }

  const updated = await db
    .update(currencySettings)
    .set({
      exchangeRate: newRate,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(currencySettings.currencyCode, currencyCode))
    .returning()
    .get();

  // Persist changes to disk
  saveDatabase();

  return updated;
}

/**
 * Update currency settings
 */
export async function update(currencyCode, data, _userId) {
  const db = await getDb();
  const currency = await db
    .select()
    .from(currencySettings)
    .where(eq(currencySettings.currencyCode, currencyCode))
    .get();

  if (!currency) {
    throw new Error('Currency not found');
  }

  const updated = await db
    .update(currencySettings)
    .set({
      ...data,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(currencySettings.currencyCode, currencyCode))
    .returning()
    .get();

  // Persist changes to disk
  saveDatabase();

  return updated;
}

/**
 * Get active currencies
 */
export async function getActiveCurrencies() {
  const db = await getDb();
  const currencies = await db
    .select()
    .from(currencySettings)
    .where(eq(currencySettings.isActive, true))
    .all();

  return currencies;
}

/**
 * Get base currency
 */
export async function getBaseCurrency() {
  const db = await getDb();
  const currency = await db
    .select()
    .from(currencySettings)
    .where(eq(currencySettings.isBaseCurrency, true))
    .get();

  return currency;
}
