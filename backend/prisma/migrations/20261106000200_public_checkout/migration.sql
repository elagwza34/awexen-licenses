BEGIN;
ALTER TABLE "plans" ADD COLUMN "setup_fee" INTEGER NOT NULL DEFAULT 0 CHECK (setup_fee >= 0);
ALTER TABLE "customers" ADD COLUMN "requested_plan_id" INTEGER REFERENCES "plans"("id") ON DELETE SET NULL;
ALTER TABLE "payments" ADD COLUMN "plan_id" INTEGER REFERENCES "plans"("id") ON DELETE RESTRICT;
-- Existing customer plans and licences retain their original prices and rights.
-- These three presets were archived and have never been sold.
UPDATE plans SET name='Starter',name_ar='الأساسية',price=150000,setup_fee=300000,status='ACTIVE',updated_at=NOW() WHERE key='PMS_STARTER' AND status='ARCHIVED';
UPDATE plans SET name='Growth',name_ar='النمو',price=350000,setup_fee=500000,status='ACTIVE',updated_at=NOW() WHERE key='PMS_PRO' AND status='ARCHIVED';
UPDATE plans SET name='Scale',name_ar='المتقدمة',price=650000,setup_fee=800000,status='ACTIVE',updated_at=NOW() WHERE key='PMS_BUSINESS' AND status='ARCHIVED';
INSERT INTO plans (key,name,name_ar,price,currency,billing_interval,setup_fee,enforce_entitlements,max_users,max_branches,max_warehouses,max_devices,sort_order,status,updated_at)
SELECT key || '_YEARLY',name || ' Annual',name_ar || ' — سنوي', CASE key WHEN 'PMS_STARTER' THEN 1440000 WHEN 'PMS_PRO' THEN 3360000 ELSE 6240000 END,currency,'YEARLY',setup_fee,enforce_entitlements,max_users,max_branches,max_warehouses,max_devices,sort_order+10,'ACTIVE',NOW()
FROM plans WHERE key IN ('PMS_STARTER','PMS_PRO','PMS_BUSINESS');
INSERT INTO plan_features ("planId","featureId") SELECT annual.id,pf."featureId" FROM plans monthly JOIN plans annual ON annual.key=monthly.key || '_YEARLY' JOIN plan_features pf ON pf."planId"=monthly.id WHERE monthly.key IN ('PMS_STARTER','PMS_PRO','PMS_BUSINESS');
COMMIT;
