-- ── Invoice sequencing & finalization protection ──────────────────────────
-- Replaces the old timestamp-based invoice number with a transactional,
-- per-branch / per-year sequence so concurrent LAN clients can never collide
-- on the same invoice number. Adds an issued_at column and a trigger that
-- locks invoice_number / issued_at / branch_id on finalized sales.

-- Counter-row table. Allocations happen inside the sale-creation transaction
-- via INSERT ... ON CONFLICT DO UPDATE ... RETURNING, which Postgres treats
-- as a single atomic operation with a row-level lock.
CREATE TABLE IF NOT EXISTS "invoice_sequences" (
  "id" serial PRIMARY KEY NOT NULL,
  "branch_id" integer NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "year" integer NOT NULL,
  "next_value" integer NOT NULL DEFAULT 1,
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoice_sequences"
    ADD CONSTRAINT "invoice_sequences_branch_year_unique" UNIQUE ("branch_id","year");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoice_sequences"
    ADD CONSTRAINT "invoice_sequences_next_value_positive" CHECK ("next_value" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Issued-at marks the moment a real (non-draft) invoice number is assigned.
-- Drafts leave it NULL until completeDraft fills it.
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "issued_at" timestamp;
--> statement-breakpoint

-- Backfill so the CHECK below can eventually be VALIDATEd.
UPDATE "sales"
   SET "issued_at" = COALESCE("created_at", now())
 WHERE "status" <> 'draft' AND "issued_at" IS NULL;
--> statement-breakpoint

-- Per-branch invoice-number uniqueness. The global unique constraint added in
-- 0000_slippery_mandroid.sql stays in place — the new composite is the spec
-- requirement and remains correct even if invoice-number formats change.
DO $$ BEGIN
  ALTER TABLE "sales"
    ADD CONSTRAINT "sales_branch_invoice_number_unique" UNIQUE ("branch_id","invoice_number");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Finalized sales must carry an issued_at; drafts may not.
DO $$ BEGIN
  ALTER TABLE "sales"
    ADD CONSTRAINT "sales_issued_at_required_when_finalized"
    CHECK ("status" = 'draft' OR "issued_at" IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Trigger: once issued_at is set, invoice_number / issued_at / branch_id are
-- immutable. Status (pending → completed → cancelled), totals, and other
-- operational fields remain editable.
CREATE OR REPLACE FUNCTION "sales_protect_finalized_invoice"() RETURNS trigger AS $$
BEGIN
  IF OLD."issued_at" IS NOT NULL THEN
    IF NEW."invoice_number" IS DISTINCT FROM OLD."invoice_number" THEN
      RAISE EXCEPTION 'invoice_number is immutable on finalized sales (sale id=%)', OLD."id";
    END IF;
    IF NEW."issued_at" IS DISTINCT FROM OLD."issued_at" THEN
      RAISE EXCEPTION 'issued_at is immutable on finalized sales (sale id=%)', OLD."id";
    END IF;
    IF NEW."branch_id" IS DISTINCT FROM OLD."branch_id" THEN
      RAISE EXCEPTION 'branch_id is immutable on finalized sales (sale id=%)', OLD."id";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "sales_protect_finalized_invoice_trigger" ON "sales";
--> statement-breakpoint
CREATE TRIGGER "sales_protect_finalized_invoice_trigger"
  BEFORE UPDATE ON "sales"
  FOR EACH ROW EXECUTE FUNCTION "sales_protect_finalized_invoice"();
