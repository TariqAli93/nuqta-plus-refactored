-- ── Expenses ──────────────────────────────────────────────────────────────
-- Operational expense tracking. One row per recorded expense (rent, salary,
-- supplies, utilities, etc.). Used by the profit calculation in reports
-- (revenue - cogs - expenses = net profit).
--
-- `category` is free-form text validated at the application layer so the
-- list of categories can be extended without a migration. Branch-scoped:
-- non-global users only see their own branch's expenses.

CREATE TABLE IF NOT EXISTS "expenses" (
  "id"          serial PRIMARY KEY NOT NULL,
  "branch_id"   integer,
  "category"    text NOT NULL,
  "amount"      numeric(18,4) NOT NULL,
  "currency"    text NOT NULL DEFAULT 'USD',
  "note"        text,
  "expense_date" date NOT NULL DEFAULT CURRENT_DATE,
  "created_by"  integer,
  "created_at"  timestamp DEFAULT now(),
  "updated_at"  timestamp DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "expenses"
    ADD CONSTRAINT "expenses_branch_id_fk" FOREIGN KEY ("branch_id")
    REFERENCES "branches"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "expenses"
    ADD CONSTRAINT "expenses_created_by_fk" FOREIGN KEY ("created_by")
    REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "expenses"
    ADD CONSTRAINT "expenses_amount_positive" CHECK (amount > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "expenses_branch_idx"
  ON "expenses" USING btree ("branch_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "expenses_category_idx"
  ON "expenses" USING btree ("category");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "expenses_expense_date_idx"
  ON "expenses" USING btree ("expense_date");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "expenses_created_at_idx"
  ON "expenses" USING btree ("created_at");
