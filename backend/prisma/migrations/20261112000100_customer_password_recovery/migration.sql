ALTER TABLE "customers" ADD COLUMN "auth_version" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "customer_password_resets" (
 "id" SERIAL PRIMARY KEY,
 "customer_id" INTEGER NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
 "token_hash" VARCHAR(64) NOT NULL UNIQUE,
 "expires_at" TIMESTAMP(3) NOT NULL,
 "used_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "customer_password_resets_customer_id_created_at_idx" ON "customer_password_resets"("customer_id","created_at");
