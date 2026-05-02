CREATE TABLE IF NOT EXISTS "cash_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"branch_id" integer,
	"opening_cash" numeric(18, 4) DEFAULT '0' NOT NULL,
	"closing_cash" numeric(18, 4),
	"expected_cash" numeric(18, 4),
	"variance" numeric(18, 4),
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"opened_at" timestamp DEFAULT now(),
	"closed_at" timestamp
);
--> statement-breakpoint
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
CREATE TABLE IF NOT EXISTS "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer,
	"category" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"note" text,
	"expense_date" date NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"scope" text NOT NULL,
	"user_id" integer,
	"response" jsonb,
	"status_code" integer DEFAULT 200 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "installment_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"installment_id" integer NOT NULL,
	"customer_id" integer,
	"sale_id" integer,
	"user_id" integer,
	"action_type" text NOT NULL,
	"note" text,
	"promised_amount" numeric(18, 4),
	"promised_date" text,
	"old_due_date" text,
	"new_due_date" text,
	"payment_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_sequences" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer NOT NULL,
	"year" integer NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_id" integer,
	"provider" text NOT NULL,
	"channel" text NOT NULL,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"provider" text DEFAULT 'bulksmsiraq' NOT NULL,
	"api_key_encrypted" text,
	"sender_id" text,
	"sms_enabled" boolean DEFAULT true NOT NULL,
	"whatsapp_enabled" boolean DEFAULT false NOT NULL,
	"auto_fallback_enabled" boolean DEFAULT true NOT NULL,
	"default_channel" text DEFAULT 'auto' NOT NULL,
	"overdue_reminder_enabled" boolean DEFAULT true NOT NULL,
	"payment_confirmation_enabled" boolean DEFAULT true NOT NULL,
	"bulk_messaging_enabled" boolean DEFAULT false NOT NULL,
	"single_customer_messaging_enabled" boolean DEFAULT true NOT NULL,
	"templates" jsonb,
	"last_test_at" timestamp,
	"last_test_status" text,
	"last_test_message" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"channel" text DEFAULT 'auto' NOT NULL,
	"resolved_channel" text,
	"recipient_phone" text NOT NULL,
	"customer_id" integer,
	"sale_id" integer,
	"installment_id" integer,
	"payment_id" integer,
	"template" text,
	"payload" jsonb,
	"message_body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now(),
	"dedupe_key" text,
	"error" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"created_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_stock_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"remaining_quantity" integer NOT NULL,
	"cost_price" numeric(18, 4) NOT NULL,
	"expiry_date" date,
	"received_at" timestamp DEFAULT now(),
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"created_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_units" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"name" text NOT NULL,
	"conversion_factor" numeric(18, 6) DEFAULT '1' NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	"is_default_sale" boolean DEFAULT false NOT NULL,
	"is_default_purchase" boolean DEFAULT false NOT NULL,
	"barcode" text,
	"sale_price" numeric(18, 4),
	"cost_price" numeric(18, 4),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sale_item_stock_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"sale_item_id" integer NOT NULL,
	"product_stock_entry_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sale_return_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_id" integer NOT NULL,
	"sale_item_id" integer,
	"product_id" integer,
	"product_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"subtotal" numeric(18, 4) NOT NULL,
	"unit_id" integer,
	"unit_name" text,
	"unit_conversion_factor" numeric(18, 6) DEFAULT '1' NOT NULL,
	"base_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sale_returns" (
	"id" serial PRIMARY KEY NOT NULL,
	"sale_id" integer NOT NULL,
	"customer_id" integer,
	"branch_id" integer,
	"warehouse_id" integer,
	"returned_value" numeric(18, 4) NOT NULL,
	"refund_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"debt_reduction" numeric(18, 4) DEFAULT '0' NOT NULL,
	"refund_method" text,
	"refund_reference" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"reason" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"created_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouse_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer NOT NULL,
	"from_warehouse_id" integer NOT NULL,
	"to_warehouse_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" integer,
	"approved_by" integer,
	"approved_at" timestamp,
	"rejection_reason" text,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "warehouses" ALTER COLUMN "branch_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "default_warehouse_id" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "normalized_phone" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payment_reference" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "cash_session_id" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tracks_expiry" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "unit_id" integer;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "unit_name" text;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "unit_conversion_factor" numeric(18, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "base_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "unit_cost_price" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "cash_session_id" integer;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "sale_source" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "sale_type" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "issued_at" timestamp;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "unit_id" integer;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "unit_name" text;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "unit_quantity" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "assigned_branch_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "assigned_warehouse_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
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
DO $$ BEGIN
 ALTER TABLE "credit_scores" ADD CONSTRAINT "credit_scores_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_snapshots" ADD CONSTRAINT "credit_snapshots_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "installment_actions" ADD CONSTRAINT "installment_actions_installment_id_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."installments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "installment_actions" ADD CONSTRAINT "installment_actions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "installment_actions" ADD CONSTRAINT "installment_actions_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "installment_actions" ADD CONSTRAINT "installment_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "installment_actions" ADD CONSTRAINT "installment_actions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_installment_id_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."installments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_stock_entries" ADD CONSTRAINT "product_stock_entries_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_stock_entries" ADD CONSTRAINT "product_stock_entries_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_stock_entries" ADD CONSTRAINT "product_stock_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_units" ADD CONSTRAINT "product_units_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_item_stock_entries" ADD CONSTRAINT "sale_item_stock_entries_sale_item_id_sale_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_item_stock_entries" ADD CONSTRAINT "sale_item_stock_entries_product_stock_entry_id_product_stock_entries_id_fk" FOREIGN KEY ("product_stock_entry_id") REFERENCES "public"."product_stock_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_return_id_sale_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sale_returns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_sale_item_id_sale_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_unit_id_product_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."product_units"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_sessions_user_idx" ON "cash_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_sessions_branch_idx" ON "cash_sessions" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_sessions_status_idx" ON "cash_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_events_customer_idx" ON "credit_events" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_events_type_idx" ON "credit_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_events_created_at_idx" ON "credit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_scores_customer_idx" ON "credit_scores" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_scores_created_at_idx" ON "credit_scores" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_scores_version_idx" ON "credit_scores" USING btree ("model_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_snapshots_customer_idx" ON "credit_snapshots" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_snapshots_snapshot_date_idx" ON "credit_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_snapshots_label_idx" ON "credit_snapshots" USING btree ("label_defaulted");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_snapshots_customer_date_idx" ON "credit_snapshots" USING btree ("customer_id","snapshot_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_branch_idx" ON "expenses" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_category_idx" ON "expenses" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_expense_date_idx" ON "expenses" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_created_at_idx" ON "expenses" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_key_scope_unique" ON "idempotency_keys" USING btree ("key","scope");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_keys_created_at_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "installment_actions_installment_idx" ON "installment_actions" USING btree ("installment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "installment_actions_customer_idx" ON "installment_actions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "installment_actions_created_at_idx" ON "installment_actions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_sequences_branch_year_unique" ON "invoice_sequences" USING btree ("branch_id","year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_logs_notification_idx" ON "notification_logs" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_logs_created_at_idx" ON "notification_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_status_idx" ON "notifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_next_attempt_idx" ON "notifications" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_customer_idx" ON "notifications" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_type_idx" ON "notifications" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_dedupe_idx" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_stock_entries_product_warehouse_idx" ON "product_stock_entries" USING btree ("product_id","warehouse_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_stock_entries_expiry_idx" ON "product_stock_entries" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_item_stock_entries_sale_item_idx" ON "sale_item_stock_entries" USING btree ("sale_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_item_stock_entries_stock_entry_idx" ON "sale_item_stock_entries" USING btree ("product_stock_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_return_items_return_idx" ON "sale_return_items" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_return_items_sale_item_idx" ON "sale_return_items" USING btree ("sale_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_returns_sale_idx" ON "sale_returns" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_returns_customer_idx" ON "sale_returns" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_returns_created_at_idx" ON "sale_returns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_transfers_status_idx" ON "warehouse_transfers" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_transfers_branch_idx" ON "warehouse_transfers" USING btree ("branch_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_unit_id_product_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."product_units"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales" ADD CONSTRAINT "sales_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unit_id_product_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."product_units"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
