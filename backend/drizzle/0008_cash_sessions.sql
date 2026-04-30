-- ── Cash Sessions / Shift Closing ──────────────────────────────────────────
-- Adds the `cash_sessions` table that tracks per-cashier cash drawer
-- accountability for POS shifts, and a foreign key column on sales/payments
-- so cash transactions can be tied back to the session that recorded them.
--
-- Business rules enforced at the application layer:
--   - A user may have only one open session per branch at a time (partial
--     unique index below enforces the same at DB level).
--   - POS cash sales require an open session.
--   - Closing a session computes:
--       expected_cash = opening_cash + cash_in - cash_out
--       variance      = closing_cash - expected_cash
--   - Closed sessions are immutable.

CREATE TABLE IF NOT EXISTS "cash_sessions" (
  "id"            serial PRIMARY KEY NOT NULL,
  "user_id"       integer NOT NULL,
  "branch_id"     integer,
  "opening_cash"  numeric(18,4) NOT NULL DEFAULT 0,
  "closing_cash"  numeric(18,4),
  "expected_cash" numeric(18,4),
  "variance"      numeric(18,4),
  "currency"      text NOT NULL DEFAULT 'USD',
  "status"        text NOT NULL DEFAULT 'open',
  "notes"         text,
  "opened_at"     timestamp DEFAULT now(),
  "closed_at"     timestamp
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "cash_sessions"
    ADD CONSTRAINT "cash_sessions_user_id_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "cash_sessions"
    ADD CONSTRAINT "cash_sessions_branch_id_fk" FOREIGN KEY ("branch_id")
    REFERENCES "branches"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "cash_sessions"
    ADD CONSTRAINT "cash_sessions_status_check"
    CHECK ("status" IN ('open','closed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "cash_sessions"
    ADD CONSTRAINT "cash_sessions_opening_cash_nonneg"
    CHECK ("opening_cash" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "cash_sessions_user_idx"
  ON "cash_sessions" USING btree ("user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "cash_sessions_branch_idx"
  ON "cash_sessions" USING btree ("branch_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "cash_sessions_status_idx"
  ON "cash_sessions" USING btree ("status");
--> statement-breakpoint

-- Enforce "one open session per user per branch" at the DB level. NULL
-- branch_id is treated as a distinct group via COALESCE so single-branch
-- deployments still work.
CREATE UNIQUE INDEX IF NOT EXISTS "cash_sessions_open_user_branch_idx"
  ON "cash_sessions" ("user_id", COALESCE("branch_id", 0))
  WHERE "status" = 'open';
--> statement-breakpoint

-- ── Link sales + payments to a cash session ──────────────────────────────
ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "cash_session_id" integer;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sales"
    ADD CONSTRAINT "sales_cash_session_id_fk" FOREIGN KEY ("cash_session_id")
    REFERENCES "cash_sessions"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_cash_session_idx"
  ON "sales" USING btree ("cash_session_id");
--> statement-breakpoint

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "cash_session_id" integer;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "payments"
    ADD CONSTRAINT "payments_cash_session_id_fk" FOREIGN KEY ("cash_session_id")
    REFERENCES "cash_sessions"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payments_cash_session_idx"
  ON "payments" USING btree ("cash_session_id");
