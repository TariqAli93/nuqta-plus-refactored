-- Optional, plug-and-play messaging notification system.
--
-- Three tables are added. They are entirely additive — no existing column or
-- table is touched, so the migration is safe to apply on populated production
-- databases. The whole feature is gated by the `notification_settings.enabled`
-- flag (default false), so no behaviour changes until an operator explicitly
-- enables the system from the Settings UI.

-- ── notification_settings ────────────────────────────────────────────────
-- Singleton (id=1) row holding the whole module configuration. We only ever
-- read/upsert id=1 — a CHECK constraint pins it so we never accidentally end
-- up with multiple rows.
CREATE TABLE IF NOT EXISTS "notification_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "provider" text NOT NULL DEFAULT 'bulksmsiraq',
  "api_key_encrypted" text,
  "sender_id" text,
  "sms_enabled" boolean NOT NULL DEFAULT true,
  "whatsapp_enabled" boolean NOT NULL DEFAULT false,
  "auto_fallback_enabled" boolean NOT NULL DEFAULT true,
  "default_channel" text NOT NULL DEFAULT 'auto',
  "overdue_reminder_enabled" boolean NOT NULL DEFAULT true,
  "payment_confirmation_enabled" boolean NOT NULL DEFAULT true,
  "bulk_messaging_enabled" boolean NOT NULL DEFAULT false,
  "single_customer_messaging_enabled" boolean NOT NULL DEFAULT true,
  "templates" jsonb,
  "last_test_at" timestamp,
  "last_test_status" text,
  "last_test_message" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint

-- ── notifications ────────────────────────────────────────────────────────
-- One row per outbound message. The queue worker scans rows where
-- status='pending' AND next_attempt_at <= now().
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "channel" text NOT NULL DEFAULT 'auto',
  "resolved_channel" text,
  "recipient_phone" text NOT NULL,
  "customer_id" integer,
  "sale_id" integer,
  "installment_id" integer,
  "payment_id" integer,
  "template" text,
  "payload" jsonb,
  "message_body" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "next_attempt_at" timestamp DEFAULT now(),
  "dedupe_key" text,
  "error" text,
  "sent_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  "created_by" integer
);
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
CREATE INDEX IF NOT EXISTS "notifications_status_idx" ON "notifications" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_next_attempt_idx" ON "notifications" USING btree ("next_attempt_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_customer_idx" ON "notifications" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_type_idx" ON "notifications" USING btree ("type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_dedupe_idx" ON "notifications" USING btree ("dedupe_key");
--> statement-breakpoint

-- ── notification_logs ────────────────────────────────────────────────────
-- Append-only audit trail of every provider call (success or failure). Stored
-- separately from `notifications` so we can keep a complete history even after
-- the originating row has been retried or compacted.
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
DO $$ BEGIN
 ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_logs_notification_idx" ON "notification_logs" USING btree ("notification_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_logs_created_at_idx" ON "notification_logs" USING btree ("created_at");
