-- Inspects the newest subscription/licence pairs so date drift is visible.
-- Run with:
--   .\tools\pgsql\bin\psql.exe -h 127.0.0.1 -U postgres -d owneradmin -f tools\check-sync.sql
--
-- Note: expires_at is mapped to snake_case, but `subscriptionId` is not.
SELECT
  s.id                          AS subscription_id,
  s.expires_at                  AS subscription_expiry,
  l.id                          AS licence_id,
  l.expires_at                  AS licence_expiry,
  l.status                      AS licence_status,
  (s.expires_at = l.expires_at) AS in_sync
FROM subscriptions s
JOIN licenses l ON l."subscriptionId" = s.id
ORDER BY s.id DESC
LIMIT 10;
