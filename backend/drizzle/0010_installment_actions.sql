-- ── Installment Collection Workflow ────────────────────────────────────────
-- Adds the `installment_actions` table — a lightweight activity log for the
-- collections workflow. One row per interaction with a customer about a
-- specific installment.
--
-- Action types (enforced at the application layer, not via CHECK so the set
-- can be extended without a migration):
--   call, visit, promise_to_pay, reschedule, note, payment
--
-- Money for `payment` actions still flows through the existing `payments`
-- table; `payment_id` here just links the action to that payment row.

CREATE TABLE IF NOT EXISTS "installment_actions" (
  "id"              serial PRIMARY KEY NOT NULL,
  "installment_id"  integer NOT NULL,
  "customer_id"     integer,
  "sale_id"         integer,
  "user_id"         integer,
  "action_type"     text NOT NULL,
  "note"            text,
  "promised_amount" numeric(18,4),
  "promised_date"   text,
  "old_due_date"    text,
  "new_due_date"    text,
  "payment_id"      integer,
  "created_at"      timestamp DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "installment_actions"
    ADD CONSTRAINT "installment_actions_installment_id_fk" FOREIGN KEY ("installment_id")
    REFERENCES "installments"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "installment_actions"
    ADD CONSTRAINT "installment_actions_customer_id_fk" FOREIGN KEY ("customer_id")
    REFERENCES "customers"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "installment_actions"
    ADD CONSTRAINT "installment_actions_sale_id_fk" FOREIGN KEY ("sale_id")
    REFERENCES "sales"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "installment_actions"
    ADD CONSTRAINT "installment_actions_user_id_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "installment_actions"
    ADD CONSTRAINT "installment_actions_payment_id_fk" FOREIGN KEY ("payment_id")
    REFERENCES "payments"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "installment_actions_installment_idx"
  ON "installment_actions" USING btree ("installment_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "installment_actions_customer_idx"
  ON "installment_actions" USING btree ("customer_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "installment_actions_created_at_idx"
  ON "installment_actions" USING btree ("created_at");
