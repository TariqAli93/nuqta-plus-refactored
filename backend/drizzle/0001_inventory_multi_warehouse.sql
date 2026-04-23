-- Inventory multi-branch / multi-warehouse migration
-- Adds branches, warehouses, product_stock, stock_movements
-- Extends products with low_stock_threshold and sales with branch_id / warehouse_id

CREATE TABLE IF NOT EXISTS "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "branches_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"branch_id" integer NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_stock" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_stock_product_warehouse_idx" ON "product_stock" ("product_id","warehouse_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"movement_type" text NOT NULL,
	"quantity_change" integer NOT NULL,
	"quantity_before" integer NOT NULL,
	"quantity_after" integer NOT NULL,
	"reference_type" text,
	"reference_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"created_by" integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_movements_warehouse_idx" ON "stock_movements" ("warehouse_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_movements_product_idx" ON "stock_movements" ("product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_movements_created_at_idx" ON "stock_movements" ("created_at");
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "low_stock_threshold" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "branch_id" integer;
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "warehouse_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_stock" ADD CONSTRAINT "product_stock_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_stock" ADD CONSTRAINT "product_stock_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales" ADD CONSTRAINT "sales_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales" ADD CONSTRAINT "sales_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Bootstrap a default branch + warehouse so existing sales flow keeps working.
-- Backfills existing sales with the default warehouse and seeds product_stock
-- from the legacy products.stock column (as opening balance).
INSERT INTO "branches" ("name", "address", "is_active")
VALUES ('الفرع الرئيسي', NULL, true)
ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint
INSERT INTO "warehouses" ("name", "branch_id", "is_active")
SELECT 'المخزن الرئيسي', b.id, true
FROM "branches" b
WHERE b.name = 'الفرع الرئيسي'
  AND NOT EXISTS (
    SELECT 1 FROM "warehouses" w WHERE w.branch_id = b.id AND w.name = 'المخزن الرئيسي'
  );
--> statement-breakpoint
-- Seed product_stock rows from legacy products.stock
INSERT INTO "product_stock" ("product_id", "warehouse_id", "quantity")
SELECT p.id, w.id, COALESCE(p.stock, 0)
FROM "products" p
CROSS JOIN "warehouses" w
JOIN "branches" b ON w.branch_id = b.id
WHERE b.name = 'الفرع الرئيسي'
  AND w.name = 'المخزن الرئيسي'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Opening balance movement for seeded stock (> 0 only)
INSERT INTO "stock_movements"
  ("product_id", "warehouse_id", "movement_type", "quantity_change",
   "quantity_before", "quantity_after", "reference_type", "notes")
SELECT ps.product_id, ps.warehouse_id, 'opening_balance', ps.quantity,
       0, ps.quantity, 'migration', 'Opening balance from legacy products.stock'
FROM "product_stock" ps
WHERE ps.quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM "stock_movements" m
    WHERE m.product_id = ps.product_id
      AND m.warehouse_id = ps.warehouse_id
      AND m.movement_type = 'opening_balance'
  );
--> statement-breakpoint
-- Backfill existing sales with the default branch/warehouse
UPDATE "sales" s
SET branch_id = b.id, warehouse_id = w.id
FROM "branches" b
JOIN "warehouses" w ON w.branch_id = b.id
WHERE b.name = 'الفرع الرئيسي'
  AND w.name = 'المخزن الرئيسي'
  AND s.branch_id IS NULL;
