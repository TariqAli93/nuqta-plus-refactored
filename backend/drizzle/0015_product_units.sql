-- ── Product Units ─────────────────────────────────────────────────────────
-- Multi-unit support for products (قطعة / درزن / كارتون / علبة …). Each
-- product has exactly one base unit (conversion_factor = 1) and may declare
-- additional units that map back to it via `conversion_factor`. Inventory is
-- always stored in the base unit; the unit on a sale or stock movement is a
-- display/snapshot helper that gets multiplied by `conversion_factor` before
-- it touches `product_stock` / `product_stock_entries`.

CREATE TABLE IF NOT EXISTS product_units (
  id serial PRIMARY KEY,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL,
  conversion_factor numeric(18,6) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  is_base boolean NOT NULL DEFAULT false,
  is_default_sale boolean NOT NULL DEFAULT false,
  is_default_purchase boolean NOT NULL DEFAULT false,
  barcode text,
  sale_price numeric(18,4),
  cost_price numeric(18,4),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_units_product_name_idx
  ON product_units(product_id, name);
CREATE INDEX IF NOT EXISTS product_units_product_idx
  ON product_units(product_id);
CREATE INDEX IF NOT EXISTS product_units_barcode_idx
  ON product_units(barcode) WHERE barcode IS NOT NULL;

-- Backfill: every existing product gets a base unit so legacy callers that
-- don't pass a unitId continue to work. Use the existing products.unit text
-- if it's set and Arabic-friendly, otherwise fall back to "قطعة".
INSERT INTO product_units (product_id, name, conversion_factor, is_base, is_default_sale, is_default_purchase)
SELECT
  p.id,
  CASE
    WHEN p.unit IS NULL OR p.unit = '' OR p.unit = 'piece' THEN 'قطعة'
    ELSE p.unit
  END,
  1,
  true,
  true,
  true
FROM products p
WHERE NOT EXISTS (
  SELECT 1 FROM product_units pu WHERE pu.product_id = p.id
);

-- ── Sale items: snapshot of the unit used for historical accuracy ─────────
-- All four columns are nullable on purpose so legacy rows stay valid. New
-- writes always populate them (defaulting to base when no unit is selected).
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS unit_id integer REFERENCES product_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_name text,
  ADD COLUMN IF NOT EXISTS unit_conversion_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_quantity integer NOT NULL DEFAULT 0;

-- Backfill base_quantity from quantity for existing rows so reports stay
-- consistent when they switch to using base_quantity.
UPDATE sale_items
SET base_quantity = quantity
WHERE base_quantity = 0 AND quantity > 0;

-- ── Stock movements: store the human unit used (display only) ─────────────
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS unit_id integer REFERENCES product_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_name text,
  ADD COLUMN IF NOT EXISTS unit_quantity numeric(18,6);

-- ── Sale return items: capture the unit so the receipt matches the sale ──
ALTER TABLE sale_return_items
  ADD COLUMN IF NOT EXISTS unit_id integer REFERENCES product_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_name text,
  ADD COLUMN IF NOT EXISTS unit_conversion_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_quantity integer NOT NULL DEFAULT 0;

UPDATE sale_return_items
SET base_quantity = quantity
WHERE base_quantity = 0 AND quantity > 0;
