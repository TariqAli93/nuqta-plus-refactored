-- Repair existing OPEN accounting periods that were created with branch_id = NULL
-- while multi-branch was off. Shifts always carry a (default) branch, so a
-- null-branch period could never be matched to its shift's branch. Bind such
-- open periods to the system default branch (the oldest branch), matching the
-- new resolveEffectiveBranchId logic.
--
-- Safety:
--   * Only OPEN periods are touched — historic CLOSED periods keep their stored
--     branch_id (their frozen snapshot is read by id, never re-scoped by branch).
--   * No-op when no branch exists yet (a fresh install creates the default
--     branch lazily on the first open()), or when there are no null-branch open
--     periods (multi-branch deployments already store a real branch).
--   * The partial unique index allows at most one open null-branch period, so
--     this update can never collide on COALESCE(branch_id,0).
UPDATE "accounting_periods"
SET "branch_id" = (SELECT MIN("id") FROM "branches"),
    "updated_at" = now()
WHERE "status" = 'open'
  AND "branch_id" IS NULL
  AND EXISTS (SELECT 1 FROM "branches");
