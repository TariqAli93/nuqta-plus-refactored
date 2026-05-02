import { eq, and } from 'drizzle-orm';
import { getDb } from '../db.js';
import { productUnits } from '../models/index.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';

/**
 * Product-units helper. Encapsulates the rules so every caller (product
 * create/update, sale, inventory adjust, return) goes through the same
 * validated path:
 *
 *   - Each product has exactly one base unit (conversionFactor = 1).
 *   - Unit names are unique per product.
 *   - Barcodes are unique per product when provided.
 *   - `conversionFactor > 0`.
 *
 * The base unit is the source of truth for stock. Every other unit's
 * conversionFactor describes "how many base units does this unit hold?".
 */

const DEFAULT_BASE_UNIT_NAME = 'قطعة';

/**
 * Snapshot returned to callers — number-typed, frontend-friendly.
 */
function shapeUnitRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    productId: row.productId,
    name: row.name,
    conversionFactor: Number(row.conversionFactor) || 1,
    isBase: !!row.isBase,
    isDefaultSale: !!row.isDefaultSale,
    isDefaultPurchase: !!row.isDefaultPurchase,
    barcode: row.barcode || null,
    salePrice: row.salePrice == null ? null : Number(row.salePrice),
    costPrice: row.costPrice == null ? null : Number(row.costPrice),
    isActive: row.isActive !== false,
  };
}

/** All units for a product, base unit first then by id. */
export async function listProductUnits(productId) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(productUnits)
    .where(eq(productUnits.productId, productId));
  rows.sort((a, b) => {
    if (a.isBase && !b.isBase) return -1;
    if (!a.isBase && b.isBase) return 1;
    return (a.id || 0) - (b.id || 0);
  });
  return rows.map(shapeUnitRow);
}

/** Returns the unit row (raw schema shape) for a product+unit pair. */
export async function getUnitForProduct(tx, productId, unitId) {
  if (!unitId) return null;
  const [row] = await tx
    .select()
    .from(productUnits)
    .where(and(eq(productUnits.id, unitId), eq(productUnits.productId, productId)))
    .limit(1);
  return row || null;
}

/** Returns the base unit row for a product. Throws when missing. */
export async function getBaseUnitForProduct(tx, productId) {
  const [row] = await tx
    .select()
    .from(productUnits)
    .where(and(eq(productUnits.productId, productId), eq(productUnits.isBase, true)))
    .limit(1);
  if (row) return row;
  // Self-heal: legacy products without a base unit row get one inserted now.
  const [created] = await tx
    .insert(productUnits)
    .values({
      productId,
      name: DEFAULT_BASE_UNIT_NAME,
      conversionFactor: '1',
      isBase: true,
      isDefaultSale: true,
      isDefaultPurchase: true,
      isActive: true,
    })
    .returning();
  return created;
}

/**
 * Resolve the unit for a given (productId, unitId) and return a snapshot
 * suitable for storing on sale_items / stock_movements / sale_return_items.
 *
 * If `unitId` is null/undefined we fall back to the product's base unit so
 * the caller never has to special-case "no unit selected" — the conversion
 * factor will simply be 1.
 */
export async function resolveUnitSnapshot(tx, productId, unitId) {
  let row;
  if (unitId) {
    row = await getUnitForProduct(tx, productId, unitId);
    if (!row) {
      throw new ValidationError('الوحدة غير صالحة لهذا المنتج', 'INVALID_PRODUCT_UNIT');
    }
    if (row.isActive === false) {
      throw new ValidationError('الوحدة غير مفعلة لهذا المنتج', 'INVALID_PRODUCT_UNIT');
    }
  } else {
    row = await getBaseUnitForProduct(tx, productId);
  }
  const factor = Number(row.conversionFactor) || 1;
  if (!(factor > 0)) {
    throw new ValidationError('عامل التحويل غير صالح', 'INVALID_PRODUCT_UNIT');
  }
  return {
    id: row.id,
    name: row.name,
    conversionFactor: factor,
    salePrice: row.salePrice == null ? null : Number(row.salePrice),
    costPrice: row.costPrice == null ? null : Number(row.costPrice),
    isBase: !!row.isBase,
  };
}

/**
 * Replace a product's units with the supplied list inside a transaction.
 * Idempotent: items that already exist (matched by id or by name) are
 * updated instead of duplicated. Items omitted from the payload are deleted
 * unless they are referenced by historical sales — in that case they are
 * deactivated instead of removed so old invoices keep their unit name.
 *
 * `units` accepts the shape produced by `productUnitInputSchema`.
 *
 * Returns the resulting list of units (snapshot shape).
 */
export async function replaceProductUnits(tx, productId, units) {
  const inputs = Array.isArray(units) ? units : [];

  // Validation pass 1 — duplicates / base unit count.
  const seenNames = new Set();
  const seenBarcodes = new Set();
  let baseCount = 0;
  for (const u of inputs) {
    const name = String(u.name || '').trim();
    if (!name) {
      throw new ValidationError('اسم الوحدة مطلوب', 'INVALID_PRODUCT_UNIT');
    }
    if (seenNames.has(name)) {
      throw new ValidationError(`اسم الوحدة مكرر: ${name}`, 'INVALID_PRODUCT_UNIT');
    }
    seenNames.add(name);

    if (u.barcode) {
      const bc = String(u.barcode).trim();
      if (bc) {
        if (seenBarcodes.has(bc)) {
          throw new ValidationError(`الباركود مكرر: ${bc}`, 'INVALID_PRODUCT_UNIT');
        }
        seenBarcodes.add(bc);
      }
    }

    const factor = Number(u.conversionFactor);
    if (!(factor > 0)) {
      throw new ValidationError('عامل التحويل يجب أن يكون أكبر من صفر', 'INVALID_PRODUCT_UNIT');
    }
    if (u.isBase) baseCount++;
  }

  // If nothing arrived, ensure a default base unit exists and exit.
  if (inputs.length === 0) {
    await getBaseUnitForProduct(tx, productId);
    return listProductUnitsTx(tx, productId);
  }

  // If no row is flagged as base, infer the base from conversionFactor === 1.
  let resolvedInputs = inputs.map((u) => ({ ...u }));
  if (baseCount === 0) {
    const baseIdx = resolvedInputs.findIndex(
      (u) => Number(u.conversionFactor) === 1
    );
    if (baseIdx === -1) {
      throw new ValidationError(
        'الوحدة الأساسية مفقودة — يجب أن تكون إحدى الوحدات بمعامل تحويل = 1',
        'INVALID_PRODUCT_UNIT'
      );
    }
    resolvedInputs[baseIdx].isBase = true;
    baseCount = 1;
  }
  if (baseCount > 1) {
    throw new ValidationError(
      'لا يمكن تعريف أكثر من وحدة أساسية',
      'INVALID_PRODUCT_UNIT'
    );
  }
  // The base unit must have conversionFactor 1.
  const baseInput = resolvedInputs.find((u) => u.isBase);
  if (Number(baseInput.conversionFactor) !== 1) {
    throw new ValidationError(
      'الوحدة الأساسية يجب أن يكون معامل تحويلها = 1',
      'INVALID_PRODUCT_UNIT'
    );
  }

  // Pick exactly one default sale and one default purchase. If none flagged,
  // the base unit is the default for both.
  const defaultSaleIdx = resolvedInputs.findIndex((u) => u.isDefaultSale);
  const defaultPurchaseIdx = resolvedInputs.findIndex((u) => u.isDefaultPurchase);
  if (defaultSaleIdx === -1) baseInput.isDefaultSale = true;
  if (defaultPurchaseIdx === -1) baseInput.isDefaultPurchase = true;

  // Load existing rows so we can match by id or by name.
  const existing = await tx
    .select()
    .from(productUnits)
    .where(eq(productUnits.productId, productId));
  const byId = new Map(existing.map((r) => [r.id, r]));
  const byName = new Map(existing.map((r) => [r.name, r]));

  const keptIds = new Set();
  const result = [];

  for (const u of resolvedInputs) {
    const name = String(u.name).trim();
    const match = (u.id && byId.get(u.id)) || byName.get(name) || null;
    const values = {
      productId,
      name,
      conversionFactor: String(Number(u.conversionFactor)),
      isBase: !!u.isBase,
      isDefaultSale: !!u.isDefaultSale,
      isDefaultPurchase: !!u.isDefaultPurchase,
      barcode: u.barcode ? String(u.barcode).trim() || null : null,
      salePrice:
        u.salePrice === null || u.salePrice === undefined || u.salePrice === ''
          ? null
          : String(Number(u.salePrice)),
      costPrice:
        u.costPrice === null || u.costPrice === undefined || u.costPrice === ''
          ? null
          : String(Number(u.costPrice)),
      isActive: u.isActive !== false,
      updatedAt: new Date(),
    };

    if (match) {
      const [updated] = await tx
        .update(productUnits)
        .set(values)
        .where(eq(productUnits.id, match.id))
        .returning();
      keptIds.add(updated.id);
      result.push(updated);
    } else {
      const [inserted] = await tx
        .insert(productUnits)
        .values(values)
        .returning();
      keptIds.add(inserted.id);
      result.push(inserted);
    }
  }

  // Deactivate (rather than delete) units that historical rows reference, so
  // old sale_items / stock_movements keep their FK. Units with no inbound
  // references can be safely deleted.
  const orphans = existing.filter((r) => !keptIds.has(r.id));
  for (const o of orphans) {
    try {
      await tx.delete(productUnits).where(eq(productUnits.id, o.id));
    } catch {
      await tx
        .update(productUnits)
        .set({ isActive: false, isBase: false, isDefaultSale: false, isDefaultPurchase: false, updatedAt: new Date() })
        .where(eq(productUnits.id, o.id));
    }
  }

  result.sort((a, b) => {
    if (a.isBase && !b.isBase) return -1;
    if (!a.isBase && b.isBase) return 1;
    return (a.id || 0) - (b.id || 0);
  });
  return result.map(shapeUnitRow);
}

/** Same as listProductUnits but uses the supplied tx. */
async function listProductUnitsTx(tx, productId) {
  const rows = await tx
    .select()
    .from(productUnits)
    .where(eq(productUnits.productId, productId));
  rows.sort((a, b) => {
    if (a.isBase && !b.isBase) return -1;
    if (!a.isBase && b.isBase) return 1;
    return (a.id || 0) - (b.id || 0);
  });
  return rows.map(shapeUnitRow);
}

/** Ensures a base unit exists for the given product (no-op when present). */
export async function ensureBaseUnit(tx, productId, baseUnitName = DEFAULT_BASE_UNIT_NAME) {
  const [existing] = await tx
    .select()
    .from(productUnits)
    .where(and(eq(productUnits.productId, productId), eq(productUnits.isBase, true)))
    .limit(1);
  if (existing) return shapeUnitRow(existing);
  const [created] = await tx
    .insert(productUnits)
    .values({
      productId,
      name: baseUnitName,
      conversionFactor: '1',
      isBase: true,
      isDefaultSale: true,
      isDefaultPurchase: true,
      isActive: true,
    })
    .returning();
  return shapeUnitRow(created);
}

export const PRODUCT_UNIT_DEFAULT_BASE_NAME = DEFAULT_BASE_UNIT_NAME;
