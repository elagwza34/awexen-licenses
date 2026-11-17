ALTER TABLE "plans" ADD COLUMN "monthly_price" INTEGER, ADD COLUMN "yearly_price" INTEGER;
ALTER TABLE "plans" ADD CONSTRAINT "plan_monthly_price_nonnegative" CHECK (monthly_price IS NULL OR monthly_price >= 0), ADD CONSTRAINT "plan_yearly_price_nonnegative" CHECK (yearly_price IS NULL OR yearly_price >= 0);
ALTER TABLE "subscriptions" ADD COLUMN "billing_periods" JSONB;
ALTER TABLE "subscriptions" ADD COLUMN "billing_version" INTEGER NOT NULL DEFAULT 0;
CREATE FUNCTION bump_subscription_billing_version() RETURNS trigger AS $$
BEGIN
  NEW.billing_version := OLD.billing_version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER subscriptions_billing_revision BEFORE UPDATE ON "subscriptions"
FOR EACH ROW EXECUTE FUNCTION bump_subscription_billing_version();
CREATE TABLE "checkout_quotes" ("id" UUID NOT NULL, "customer_id" INTEGER NOT NULL, "data" JSONB NOT NULL, "expires_at" TIMESTAMP(3) NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "checkout_quotes_pkey" PRIMARY KEY ("id"));
ALTER TABLE "checkout_quotes" ADD CONSTRAINT "checkout_quotes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "checkout_quotes_customer_id_expires_at_idx" ON "checkout_quotes"("customer_id", "expires_at");
ALTER TABLE "payments" ADD COLUMN "checkout_quote_id" UUID, ADD COLUMN "billing_applied_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "payments_checkout_quote_id_key" ON "payments"("checkout_quote_id");
ALTER TABLE "payments" ADD CONSTRAINT "payments_checkout_quote_id_fkey" FOREIGN KEY ("checkout_quote_id") REFERENCES "checkout_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
