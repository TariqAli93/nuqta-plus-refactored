-- ── Sale items: per-unit cost snapshot ──────────────────────────────────
-- Splits out from 0015 because some installations already applied an earlier
-- version of 0015 that did not include this column. Both fresh and existing
-- databases land on the same shape after this migration.
--
-- `unit_cost_price` is the per-SELECTED-unit cost frozen at sale time so
-- profit reports stay correct after the catalog's unit cost override
-- changes (or the override is removed entirely). NULL on legacy rows —
-- saleService.getById / getSalesReport fall back to
-- `products.cost_price * base_quantity` for those.
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS unit_cost_price numeric(18,4);
