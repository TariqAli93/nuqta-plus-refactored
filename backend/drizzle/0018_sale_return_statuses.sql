-- ── Allow return statuses on sales.status ────────────────────────────────
-- saleService.createReturn writes either 'returned' (the whole sale was
-- returned) or 'partially_returned' (some lines came back), but the
-- original 0007 check constraint only allowed pending/completed/cancelled/
-- draft. Returns crashed with errcode 23514 until we widen the set here.

ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_status_check;

DO $$ BEGIN
  ALTER TABLE sales
    ADD CONSTRAINT sales_status_check
    CHECK (status IN (
      'pending',
      'completed',
      'cancelled',
      'draft',
      'returned',
      'partially_returned'
    )) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
