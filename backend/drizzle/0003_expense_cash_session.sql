-- Link expenses to the cash-session/shift they were recorded in, so an expense
-- is bound to (accounting_period_id, cash_session_id, user_id, branch_id) and
-- gets locked when its shift or period closes.
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "cash_session_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_cash_session_idx" ON "expenses" ("cash_session_id");
