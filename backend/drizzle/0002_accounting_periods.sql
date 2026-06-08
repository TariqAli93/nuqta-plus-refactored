CREATE TABLE IF NOT EXISTS "accounting_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'monthly' NOT NULL,
	"scope_type" text DEFAULT 'global' NOT NULL,
	"branch_id" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp DEFAULT now(),
	"closed_at" timestamp,
	"opened_by_user_id" integer,
	"closed_by_user_id" integer,
	"notes" text,
	"totals_json" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounting_period_shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"accounting_period_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_period_shifts" ADD CONSTRAINT "accounting_period_shifts_period_fk" FOREIGN KEY ("accounting_period_id") REFERENCES "accounting_periods"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_period_shifts" ADD CONSTRAINT "accounting_period_shifts_shift_fk" FOREIGN KEY ("shift_id") REFERENCES "cash_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- One open period per scope: branch_id NULL (global) collapses to 0; real
-- branch ids start at 1, so global and any branch never collide. This is the
-- race-safe backstop behind the service-level "no second open period" check.
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_periods_one_open_per_scope" ON "accounting_periods" (COALESCE("branch_id", 0)) WHERE "status" = 'open';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_period_shifts_shift_unique" ON "accounting_period_shifts" ("shift_id");
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "accounting_period_id" integer;
--> statement-breakpoint
ALTER TABLE "sale_returns" ADD COLUMN IF NOT EXISTS "accounting_period_id" integer;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "accounting_period_id" integer;
--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN IF NOT EXISTS "accounting_period_id" integer;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "accounting_period_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_accounting_period_idx" ON "sales" ("accounting_period_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_returns_accounting_period_idx" ON "sale_returns" ("accounting_period_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_accounting_period_idx" ON "expenses" ("accounting_period_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_sessions_accounting_period_idx" ON "cash_sessions" ("accounting_period_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_movements_accounting_period_idx" ON "stock_movements" ("accounting_period_id");
