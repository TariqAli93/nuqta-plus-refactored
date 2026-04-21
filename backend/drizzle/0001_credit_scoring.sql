ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "credit_score" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "credit_score_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "recommended_limit" numeric(18, 4);
