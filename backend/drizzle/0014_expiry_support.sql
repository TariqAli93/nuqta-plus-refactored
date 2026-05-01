ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tracks_expiry boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS product_stock_entries (
  id serial PRIMARY KEY,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id integer NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  remaining_quantity integer NOT NULL CHECK (remaining_quantity >= 0),
  cost_price numeric(18,4) NOT NULL,
  expiry_date date NULL,
  received_at timestamp DEFAULT now(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','depleted','expired','blocked')),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  created_by integer REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS product_stock_entries_product_warehouse_idx
  ON product_stock_entries(product_id, warehouse_id);
CREATE INDEX IF NOT EXISTS product_stock_entries_expiry_idx
  ON product_stock_entries(expiry_date);

-- Backfill one non-expiring stock entry per existing product_stock row that
-- has positive quantity and no prior entry. This preserves legacy sellability
-- without inflating stock (insert only when no entries exist for that pair).
INSERT INTO product_stock_entries (
  product_id, warehouse_id, quantity, remaining_quantity, cost_price, expiry_date, status
)
SELECT
  ps.product_id,
  ps.warehouse_id,
  ps.quantity,
  ps.quantity,
  COALESCE(p.cost_price, 0),
  NULL,
  'active'
FROM product_stock ps
JOIN products p ON p.id = ps.product_id
WHERE ps.quantity > 0
  AND NOT EXISTS (
    SELECT 1
    FROM product_stock_entries pse
    WHERE pse.product_id = ps.product_id
      AND pse.warehouse_id = ps.warehouse_id
  );

CREATE TABLE IF NOT EXISTS sale_item_stock_entries (
  id serial PRIMARY KEY,
  sale_item_id integer NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  product_stock_entry_id integer NOT NULL REFERENCES product_stock_entries(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sale_item_stock_entries_sale_item_idx ON sale_item_stock_entries(sale_item_id);
CREATE INDEX IF NOT EXISTS sale_item_stock_entries_stock_entry_idx ON sale_item_stock_entries(product_stock_entry_id);
