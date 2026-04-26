-- Branch-aware defaults: per-branch default warehouse + relax warehouse.branch_id
-- so warehouses can exist independently when the multi-branch feature is off.

ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "default_warehouse_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "branches" ADD CONSTRAINT "branches_default_warehouse_id_warehouses_id_fk" FOREIGN KEY ("default_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "warehouses" ALTER COLUMN "branch_id" DROP NOT NULL;
--> statement-breakpoint
-- Backfill: set each branch's default warehouse to the first active warehouse
-- belonging to it, when none is configured yet. Existing installations get a
-- sane default without forcing the admin to revisit branch settings.
UPDATE "branches" b
SET "default_warehouse_id" = sub.id
FROM (
  SELECT DISTINCT ON (w.branch_id) w.id, w.branch_id
  FROM "warehouses" w
  WHERE w.is_active = true AND w.branch_id IS NOT NULL
  ORDER BY w.branch_id, w.id ASC
) sub
WHERE b.id = sub.branch_id AND b."default_warehouse_id" IS NULL;
