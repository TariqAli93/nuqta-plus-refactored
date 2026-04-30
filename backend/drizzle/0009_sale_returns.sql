-- ── Sale Returns / Refunds ─────────────────────────────────────────────────
-- Adds the `sale_returns` and `sale_return_items` tables. A return records
-- which items came back from a previous sale, how much cash was refunded to
-- the customer, and how much of the sale's outstanding debt was written off.
--
-- Business rules enforced at the application layer (saleService.createReturn):
--   - Returned quantity per item > 0 and <= soldQty - alreadyReturnedQty.
--   - Cannot return items from cancelled sales.
--   - refundAmount <= sale.paidAmount.
--   - debtReduction == returnedValue - refundAmount, capped to sale.remainingAmount.
--   - Stock for returned items is restored via stock_movements
--     (movement_type = 'sale_return') in the same transaction.

CREATE TABLE IF NOT EXISTS "sale_returns" (
  "id"             serial PRIMARY KEY NOT NULL,
  "sale_id"        integer NOT NULL,
  "customer_id"    integer,
  "branch_id"      integer,
  "warehouse_id"   integer,
  "returned_value" numeric(18,4) NOT NULL,
  "refund_amount"  numeric(18,4) NOT NULL DEFAULT 0,
  "debt_reduction" numeric(18,4) NOT NULL DEFAULT 0,
  "refund_method"  text,
  "refund_reference" text,
  "currency"       text NOT NULL DEFAULT 'USD',
  "reason"         text,
  "notes"          text,
  "created_at"     timestamp DEFAULT now(),
  "created_by"     integer
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sale_returns"
    ADD CONSTRAINT "sale_returns_sale_id_fk" FOREIGN KEY ("sale_id")
    REFERENCES "sales"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sale_returns"
    ADD CONSTRAINT "sale_returns_customer_id_fk" FOREIGN KEY ("customer_id")
    REFERENCES "customers"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sale_returns"
    ADD CONSTRAINT "sale_returns_branch_id_fk" FOREIGN KEY ("branch_id")
    REFERENCES "branches"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sale_returns"
    ADD CONSTRAINT "sale_returns_warehouse_id_fk" FOREIGN KEY ("warehouse_id")
    REFERENCES "warehouses"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sale_returns"
    ADD CONSTRAINT "sale_returns_created_by_fk" FOREIGN KEY ("created_by")
    REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sale_returns"
    ADD CONSTRAINT "sale_returns_amounts_nonneg"
    CHECK ("returned_value" >= 0 AND "refund_amount" >= 0 AND "debt_reduction" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sale_returns_sale_idx"
  ON "sale_returns" USING btree ("sale_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sale_returns_customer_idx"
  ON "sale_returns" USING btree ("customer_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sale_returns_created_at_idx"
  ON "sale_returns" USING btree ("created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sale_return_items" (
  "id"            serial PRIMARY KEY NOT NULL,
  "return_id"     integer NOT NULL,
  "sale_item_id"  integer,
  "product_id"    integer,
  "product_name"  text NOT NULL,
  "quantity"      integer NOT NULL,
  "unit_price"    numeric(18,4) NOT NULL,
  "subtotal"      numeric(18,4) NOT NULL,
  "created_at"    timestamp DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sale_return_items"
    ADD CONSTRAINT "sale_return_items_return_id_fk" FOREIGN KEY ("return_id")
    REFERENCES "sale_returns"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sale_return_items"
    ADD CONSTRAINT "sale_return_items_sale_item_id_fk" FOREIGN KEY ("sale_item_id")
    REFERENCES "sale_items"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sale_return_items"
    ADD CONSTRAINT "sale_return_items_product_id_fk" FOREIGN KEY ("product_id")
    REFERENCES "products"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sale_return_items"
    ADD CONSTRAINT "sale_return_items_quantity_positive"
    CHECK ("quantity" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sale_return_items_return_idx"
  ON "sale_return_items" USING btree ("return_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sale_return_items_sale_item_idx"
  ON "sale_return_items" USING btree ("sale_item_id");
