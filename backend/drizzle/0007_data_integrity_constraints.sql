-- ── Data integrity & idempotency ───────────────────────────────────────────
-- Adds DB-level CHECK constraints for the core financial / inventory fields
-- and creates the `idempotency_keys` table used to make critical write
-- endpoints (sale create, add payment, remove payment, complete draft) safe
-- to retry from unstable LAN clients.
--
-- All CHECK constraints are added with NOT VALID. New writes are enforced
-- immediately, but the migration does NOT scan existing rows — so a populated
-- production DB with legacy data will not fail to migrate. Operators can
-- VALIDATE the constraints later once historical rows have been cleaned up.

-- ── products ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "products"
    ADD CONSTRAINT "products_cost_price_nonneg" CHECK ("cost_price" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "products"
    ADD CONSTRAINT "products_selling_price_nonneg" CHECK ("selling_price" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "products"
    ADD CONSTRAINT "products_stock_nonneg" CHECK ("stock" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "products"
    ADD CONSTRAINT "products_min_stock_nonneg" CHECK ("min_stock" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "products"
    ADD CONSTRAINT "products_low_stock_threshold_nonneg" CHECK ("low_stock_threshold" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── product_stock ────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "product_stock"
    ADD CONSTRAINT "product_stock_quantity_nonneg" CHECK ("quantity" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── warehouse_transfers ──────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "warehouse_transfers"
    ADD CONSTRAINT "warehouse_transfers_quantity_positive" CHECK ("quantity" > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "warehouse_transfers"
    ADD CONSTRAINT "warehouse_transfers_status_check"
    CHECK ("status" IN ('pending','approved','rejected')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── sales ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "sales"
    ADD CONSTRAINT "sales_subtotal_nonneg" CHECK ("subtotal" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales"
    ADD CONSTRAINT "sales_discount_nonneg" CHECK ("discount" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales"
    ADD CONSTRAINT "sales_tax_nonneg" CHECK ("tax" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales"
    ADD CONSTRAINT "sales_total_nonneg" CHECK ("total" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales"
    ADD CONSTRAINT "sales_paid_amount_nonneg" CHECK ("paid_amount" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales"
    ADD CONSTRAINT "sales_remaining_amount_nonneg" CHECK ("remaining_amount" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales"
    ADD CONSTRAINT "sales_interest_rate_nonneg" CHECK ("interest_rate" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales"
    ADD CONSTRAINT "sales_interest_amount_nonneg" CHECK ("interest_amount" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales"
    ADD CONSTRAINT "sales_status_check"
    CHECK ("status" IN ('pending','completed','cancelled','draft')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales"
    ADD CONSTRAINT "sales_payment_type_check"
    CHECK ("payment_type" IN ('cash','installment','mixed')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── sale_items ───────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "sale_items"
    ADD CONSTRAINT "sale_items_quantity_positive" CHECK ("quantity" > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sale_items"
    ADD CONSTRAINT "sale_items_unit_price_nonneg" CHECK ("unit_price" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sale_items"
    ADD CONSTRAINT "sale_items_discount_nonneg" CHECK ("discount" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sale_items"
    ADD CONSTRAINT "sale_items_subtotal_nonneg" CHECK ("subtotal" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── payments ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "payments"
    ADD CONSTRAINT "payments_amount_nonneg" CHECK ("amount" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── installments ─────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "installments"
    ADD CONSTRAINT "installments_due_amount_nonneg" CHECK ("due_amount" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "installments"
    ADD CONSTRAINT "installments_paid_amount_nonneg" CHECK ("paid_amount" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "installments"
    ADD CONSTRAINT "installments_remaining_amount_nonneg" CHECK ("remaining_amount" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "installments"
    ADD CONSTRAINT "installments_number_positive" CHECK ("installment_number" > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "installments"
    ADD CONSTRAINT "installments_status_check"
    CHECK ("status" IN ('pending','paid','cancelled')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── customers ────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "customers"
    ADD CONSTRAINT "customers_total_purchases_nonneg" CHECK ("total_purchases" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "customers"
    ADD CONSTRAINT "customers_total_debt_nonneg" CHECK ("total_debt" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── notifications ────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_status_check"
    CHECK ("status" IN ('pending','processing','sent','failed','cancelled')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_attempts_nonneg" CHECK ("attempts" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── idempotency_keys ─────────────────────────────────────────────────────
-- Used by the saleService to make POST sale / add-payment / remove-payment /
-- complete-draft endpoints safe to retry. Clients send Idempotency-Key in
-- the request header; the first successful response is cached and returned
-- verbatim for any later request with the same key.
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "id" serial PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "scope" text NOT NULL,
  "user_id" integer,
  "response" jsonb,
  "status_code" integer NOT NULL DEFAULT 200,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_key_scope_unique" UNIQUE ("key","scope");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_keys_created_at_idx"
  ON "idempotency_keys" USING btree ("created_at");
