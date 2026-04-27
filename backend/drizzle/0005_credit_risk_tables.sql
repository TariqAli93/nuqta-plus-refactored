-- Credit risk system: append-only event history, training snapshots, and
-- inference logs. All three tables are additive — no existing column or
-- table is changed, so this migration is safe on populated production DBs.

CREATE TABLE IF NOT EXISTS "credit_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "customer_id" integer NOT NULL,
  "sale_id" integer,
  "event_type" text NOT NULL,
  "amount" numeric(18, 4) DEFAULT '0',
  "delay_days" integer DEFAULT 0,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_events" ADD CONSTRAINT "credit_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_events" ADD CONSTRAINT "credit_events_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_events_customer_idx" ON "credit_events" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_events_type_idx" ON "credit_events" USING btree ("event_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_events_created_at_idx" ON "credit_events" USING btree ("created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "credit_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "customer_id" integer NOT NULL,
  "snapshot_date" date NOT NULL,
  "total_sales_on_installment" integer DEFAULT 0,
  "total_paid_on_time" integer DEFAULT 0,
  "total_late_payments" integer DEFAULT 0,
  "avg_delay_days" numeric(10, 4) DEFAULT '0',
  "max_delay_days" integer DEFAULT 0,
  "current_outstanding_debt" numeric(18, 4) DEFAULT '0',
  "active_installments_count" integer DEFAULT 0,
  "completed_installments_count" integer DEFAULT 0,
  "label_defaulted" boolean DEFAULT false,
  "label_window_days" integer DEFAULT 90,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_snapshots" ADD CONSTRAINT "credit_snapshots_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_snapshots_customer_idx" ON "credit_snapshots" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_snapshots_snapshot_date_idx" ON "credit_snapshots" USING btree ("snapshot_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_snapshots_label_idx" ON "credit_snapshots" USING btree ("label_defaulted");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_snapshots_customer_date_idx" ON "credit_snapshots" USING btree ("customer_id","snapshot_date");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "credit_scores" (
  "id" serial PRIMARY KEY NOT NULL,
  "customer_id" integer NOT NULL,
  "model_version" text NOT NULL,
  "risk_probability" numeric(8, 6) NOT NULL,
  "risk_level" text NOT NULL,
  "reasons" jsonb,
  "features" jsonb,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_scores" ADD CONSTRAINT "credit_scores_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_scores_customer_idx" ON "credit_scores" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_scores_created_at_idx" ON "credit_scores" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_scores_version_idx" ON "credit_scores" USING btree ("model_version");
