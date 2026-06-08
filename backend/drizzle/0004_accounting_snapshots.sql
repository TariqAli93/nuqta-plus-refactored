-- Immutable per-period report snapshots + per-shift closing totals.
--
-- On close, the accounting period freezes a full results snapshot. We keep the
-- legacy `accounting_periods.totals_json` (read by the period detail UI) AND
-- store the same payload in a dedicated, append-only table so closed-period
-- reports always read a frozen record that never recomputes from mutable rows.
CREATE TABLE IF NOT EXISTS "accounting_period_report_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"accounting_period_id" integer NOT NULL,
	"branch_id" integer,
	"snapshot_json" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"created_by_user_id" integer
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_period_report_snapshots" ADD CONSTRAINT "acc_period_snapshot_period_fk" FOREIGN KEY ("accounting_period_id") REFERENCES "accounting_periods"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_period_report_snapshots" ADD CONSTRAINT "acc_period_snapshot_branch_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_period_report_snapshots" ADD CONSTRAINT "acc_period_snapshot_user_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- One frozen snapshot per period (close runs once).
CREATE UNIQUE INDEX IF NOT EXISTS "acc_period_snapshot_period_unique" ON "accounting_period_report_snapshots" ("accounting_period_id");
--> statement-breakpoint
-- Back-reference so a closed period can point at its frozen snapshot row.
ALTER TABLE "accounting_periods" ADD COLUMN IF NOT EXISTS "snapshot_id" integer;
--> statement-breakpoint
-- Per-shift frozen closing totals (sales/returns/expenses/payments/expected/balances).
ALTER TABLE "cash_sessions" ADD COLUMN IF NOT EXISTS "totals_json" jsonb;
--> statement-breakpoint
-- A return belongs to the same shift as its originating sale so it gets locked
-- when that shift closes and shows up in the shift's closing totals.
ALTER TABLE "sale_returns" ADD COLUMN IF NOT EXISTS "cash_session_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_returns_cash_session_idx" ON "sale_returns" ("cash_session_id");
