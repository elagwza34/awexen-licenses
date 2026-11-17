INSERT INTO customers(name,email,created_at,updated_at)
VALUES('Synthetic migration fixture','migration-fixture@example.invalid',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO licenses(license_key,"customerId","planId",status,starts_at,expires_at,max_devices,version,created_at,updated_at)
SELECT CASE p.key WHEN 'PMS_STARTER' THEN 'MIGRATION-FIXTURE-STARTER' WHEN 'PMS_PRO' THEN 'MIGRATION-FIXTURE-PRO' ELSE 'MIGRATION-FIXTURE-CUSTOM' END,
       c.id,p.id,'ACTIVE','2026-11-01T00:00:00Z','2027-11-01T00:00:00Z',
       CASE WHEN p.key='PMS_BUSINESS' THEN 99 ELSE p.max_devices END,7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM customers c CROSS JOIN plans p
WHERE c.email='migration-fixture@example.invalid' AND p.key IN ('PMS_STARTER','PMS_PRO','PMS_BUSINESS');
