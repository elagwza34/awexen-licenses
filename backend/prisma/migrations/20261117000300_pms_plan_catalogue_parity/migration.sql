BEGIN;

ALTER TABLE plans ADD COLUMN included_services TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Preserve prices, subscription periods, payments and activation keys. Canonical
-- PMS tiers receive the explicitly requested limits and human setup services.
CREATE TEMP TABLE pms_catalogue_limits ON COMMIT DROP AS
SELECT p.id, p.max_devices AS old_devices,
       CASE p.key WHEN 'PMS_STARTER' THEN 1 WHEN 'PMS_PRO' THEN 5 ELSE 20 END AS users,
       CASE p.key WHEN 'PMS_STARTER' THEN 1 WHEN 'PMS_PRO' THEN 2 ELSE 5 END AS branches,
       CASE p.key WHEN 'PMS_STARTER' THEN 1 WHEN 'PMS_PRO' THEN 2 ELSE 5 END AS warehouses,
       CASE p.key WHEN 'PMS_STARTER' THEN 1 WHEN 'PMS_PRO' THEN 4 ELSE 10 END AS devices
FROM plans p JOIN software_systems s ON s.id=p.system_id
WHERE s.key='PMS' AND p.key IN ('PMS_STARTER','PMS_PRO','PMS_BUSINESS');

-- Serialize against workstation enrollment, which locks its license row.
SELECT l.id FROM licenses l JOIN pms_catalogue_limits n ON n.id=l."planId" FOR UPDATE OF l;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM licenses l JOIN pms_catalogue_limits n ON n.id=l."planId"
    WHERE l.max_devices=n.old_devices
      AND (SELECT COUNT(*) FROM devices d WHERE d."licenseId"=l.id AND d.status='ACTIVE') > n.devices
  ) THEN
    RAISE EXCEPTION 'PMS plan limits require review: active devices exceed the requested tier capacity';
  END IF;
END $$;

-- Keep explicit per-license device overrides. Inherited device limits follow
-- their tier; renewed signatures are produced on the next issuer validation.
UPDATE licenses l
SET max_devices=CASE WHEN l.max_devices=n.old_devices THEN n.devices ELSE l.max_devices END,
    version=l.version+1, updated_at=CURRENT_TIMESTAMP
FROM pms_catalogue_limits n WHERE n.id=l."planId";

UPDATE plans p
SET max_users=n.users, max_branches=n.branches, max_warehouses=n.warehouses,
    max_devices=n.devices,
    included_services=CASE p.key
      WHEN 'PMS_STARTER' THEN ARRAY[]::TEXT[]
      WHEN 'PMS_PRO' THEN ARRAY['WOOCOMMERCE_SETUP']::TEXT[]
      ELSE ARRAY['WOOCOMMERCE_SETUP','SHIPPING_SETUP']::TEXT[] END,
    updated_at=CURRENT_TIMESTAMP
FROM pms_catalogue_limits n WHERE n.id=p.id;

INSERT INTO plan_features ("planId","featureId")
SELECT p.id,f.id FROM plans p JOIN software_systems s ON s.id=p.system_id
CROSS JOIN features f
WHERE s.key='PMS' AND p.key='PMS_PRO' AND f.key='MULTI_BRANCH'
ON CONFLICT DO NOTHING;

COMMIT;
