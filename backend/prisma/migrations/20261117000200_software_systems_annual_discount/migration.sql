CREATE TABLE "software_systems" (
  "id" SERIAL PRIMARY KEY,
  "key" VARCHAR(60) NOT NULL UNIQUE,
  "name" VARCHAR(120) NOT NULL,
  "name_ar" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "software_systems" ("id","key","name","name_ar")
VALUES (1,'PMS','Product Management System','نظام إدارة المنتجات');
SELECT setval(pg_get_serial_sequence('software_systems','id'),1,true);
ALTER TABLE "plans" ADD COLUMN "system_id" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "plans" ADD CONSTRAINT "plans_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "software_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Existing contracts, historical payments and prepaid service are unchanged.
-- Derived annual prices are calculated at quote time from the monthly price.
