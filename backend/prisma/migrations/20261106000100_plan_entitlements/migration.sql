BEGIN;
ALTER TABLE "plans" ADD COLUMN "enforce_entitlements" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "max_users" INTEGER NOT NULL DEFAULT 2, ADD COLUMN "max_branches" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "max_warehouses" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "plans" ADD CONSTRAINT "plans_positive_capacity" CHECK(max_users > 0 AND max_branches > 0 AND max_warehouses > 0);

INSERT INTO features(key,name,name_ar,category,status,created_at,updated_at) VALUES
('PRODUCTS','PRODUCTS','المنتجات','CORE','ACTIVE',now(),now()),
('INVENTORY','INVENTORY','المخزون','CORE','ACTIVE',now(),now()),
('SALES','SALES','المبيعات','CORE','ACTIVE',now(),now()),
('POS','POS','نقطة البيع','CORE','ACTIVE',now(),now()),
('CUSTOMERS','CUSTOMERS','العملاء','CORE','ACTIVE',now(),now()),
('REPORTS','REPORTS','التقارير الأساسية','CORE','ACTIVE',now(),now()),
('SUPPLIERS','SUPPLIERS','الموردون','CORE','ACTIVE',now(),now()),
('PURCHASES','PURCHASES','المشتريات','CORE','ACTIVE',now(),now()),
('EMPLOYEES','EMPLOYEES','الموظفون','CORE','ACTIVE',now(),now()),
('ATTENDANCE','ATTENDANCE','الحضور والانصراف','CORE','ACTIVE',now(),now()),
('IMPORT','IMPORT','استيراد الأصناف','CORE','ACTIVE',now(),now()),
('EXPORT','EXPORT','تصدير Excel','CORE','ACTIVE',now(),now()),
('ADVANCED_REPORTS','ADVANCED_REPORTS','التقارير المتقدمة','CORE','ACTIVE',now(),now()),
('MULTI_WAREHOUSE','MULTI_WAREHOUSE','عدة مخازن','CORE','ACTIVE',now(),now()),
('MULTI_BRANCH','MULTI_BRANCH','عدة فروع','CORE','ACTIVE',now(),now())
ON CONFLICT(key) DO NOTHING;
INSERT INTO plans(key,name,name_ar,description,price,currency,billing_interval,max_devices,enforce_entitlements,max_users,max_branches,max_warehouses,status,created_at,updated_at) VALUES('PMS_STARTER','PMS Starter','بداية','قالب PMS: حدد السعر ثم فعّل الخطة للبيع',0,'EGP','MONTHLY',1,true,2,1,1,'ARCHIVED',now(),now()) ON CONFLICT(key) DO NOTHING;
INSERT INTO plan_features("planId","featureId") SELECT p.id,f.id FROM plans p CROSS JOIN features f WHERE p.key='PMS_STARTER' AND f.key IN ('PRODUCTS','INVENTORY','SALES','POS','CUSTOMERS','REPORTS') ON CONFLICT DO NOTHING;
INSERT INTO plans(key,name,name_ar,description,price,currency,billing_interval,max_devices,enforce_entitlements,max_users,max_branches,max_warehouses,status,created_at,updated_at) VALUES('PMS_PRO','PMS Professional','احترافي','قالب PMS: حدد السعر ثم فعّل الخطة للبيع',0,'EGP','MONTHLY',1,true,5,1,3,'ARCHIVED',now(),now()) ON CONFLICT(key) DO NOTHING;
INSERT INTO plan_features("planId","featureId") SELECT p.id,f.id FROM plans p CROSS JOIN features f WHERE p.key='PMS_PRO' AND f.key IN ('PRODUCTS','INVENTORY','SALES','POS','CUSTOMERS','REPORTS','SUPPLIERS','PURCHASES','EMPLOYEES','ATTENDANCE','IMPORT','EXPORT','ADVANCED_REPORTS','MULTI_WAREHOUSE') ON CONFLICT DO NOTHING;
INSERT INTO plans(key,name,name_ar,description,price,currency,billing_interval,max_devices,enforce_entitlements,max_users,max_branches,max_warehouses,status,created_at,updated_at) VALUES('PMS_BUSINESS','PMS Business','أعمال','قالب PMS: حدد السعر ثم فعّل الخطة للبيع',0,'EGP','MONTHLY',3,true,20,5,20,'ARCHIVED',now(),now()) ON CONFLICT(key) DO NOTHING;
INSERT INTO plan_features("planId","featureId") SELECT p.id,f.id FROM plans p CROSS JOIN features f WHERE p.key='PMS_BUSINESS' AND f.key IN ('PRODUCTS','INVENTORY','SALES','POS','CUSTOMERS','REPORTS','SUPPLIERS','PURCHASES','EMPLOYEES','ATTENDANCE','IMPORT','EXPORT','ADVANCED_REPORTS','MULTI_WAREHOUSE','MULTI_BRANCH') ON CONFLICT DO NOTHING;
COMMIT;
