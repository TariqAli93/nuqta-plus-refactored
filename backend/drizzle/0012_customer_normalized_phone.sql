-- ── Customer phone normalization ─────────────────────────────────────────
-- Adds a canonical `normalized_phone` column so lookups and de-dupe checks
-- compare apples to apples regardless of how the user typed the number
-- (spaces, dashes, leading zeros, "+964" vs "00964" vs bare "0…").
--
-- Conservative migration: nullable column, no UNIQUE constraint. Existing
-- duplicates are preserved as-is (we never delete or merge customer rows).
-- Uniqueness is enforced at the service layer with an explicit
-- `allowDuplicatePhone` override for legitimate shared family numbers.

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "normalized_phone" text;
--> statement-breakpoint

-- SQL twin of backend/src/services/notifications/phone.js#normalizeIraqPhone.
-- Kept IMMUTABLE so it can be used in indexes/expressions without tripping
-- planner restrictions; behaviour must match the JS version exactly.
CREATE OR REPLACE FUNCTION "normalize_iraq_phone"(raw text) RETURNS text AS $$
DECLARE
  s text;
BEGIN
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;
  s := btrim(raw);
  IF s = '' THEN
    RETURN NULL;
  END IF;
  -- Strip everything except digits and a leading '+'
  s := regexp_replace(s, '[^0-9+]', '', 'g');
  IF substring(s from 1 for 2) = '00' THEN
    s := '+' || substring(s from 3);
  END IF;
  IF substring(s from 1 for 1) = '+' THEN
    s := substring(s from 2);
  END IF;
  -- Local 0XXXXXXXXX → strip leading 0 and prefix country code
  IF s ~ '^0[0-9]{9,10}$' THEN
    s := '964' || substring(s from 2);
  ELSIF s ~ '^7[0-9]{8,9}$' THEN
    -- Bare local mobile e.g. 7901234567 → prefix country code
    s := '964' || s;
  END IF;
  IF s !~ '^[0-9]{8,15}$' THEN
    RETURN NULL;
  END IF;
  RETURN s;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint

-- Backfill existing rows. Safe to re-run: only fills in NULLs.
-- A phone that doesn't normalise stays NULL — we don't crash the migration
-- and we don't rewrite the user-entered `phone` column.
UPDATE "customers"
   SET "normalized_phone" = "normalize_iraq_phone"("phone")
 WHERE "phone" IS NOT NULL AND "normalized_phone" IS NULL;
--> statement-breakpoint

-- Non-unique index. Lookups by phone (search, dedupe pre-check) hit this
-- instead of doing a sequential scan or a LIKE on the raw column.
CREATE INDEX IF NOT EXISTS "customers_normalized_phone_idx"
  ON "customers"("normalized_phone");
