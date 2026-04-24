-- Add card/transfer reference number to the payments table.
-- Also surfaces saleSource & saleType on the sales table so the API
-- can distinguish POS cash/card sales from NewSale instalment sales.

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "payment_reference" text;
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "sale_source" text;
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "sale_type" text;
