-- Add a per-tenant phone-format setting to the notification module so
-- operators can match BulkSMSIraq's expected wire format without a code
-- change. Three values are accepted:
--   'e164'          → '+9647901234567'  (default — what BulkSMSIraq docs use)
--   'international' → '9647901234567'   (legacy 0006 behaviour)
--   'local'         → '07901234567'     (some accounts require this)
-- NULL means "use adapter default" so existing rows keep working.

ALTER TABLE "notification_settings"
  ADD COLUMN IF NOT EXISTS "phone_format" text;
