-- Customer portal sign-in.
--
-- password_hash is nullable on purpose: the owner can create a customer by hand
-- from the panel without ever issuing portal credentials.
--
-- download_enabled is the payment gate. A customer may register and see their
-- dashboard straight away, but the download endpoint refuses until the owner
-- confirms payment. Defaulting to false means a new column can never
-- accidentally hand downloads to existing customers.
ALTER TABLE "customers"
  ADD COLUMN "password_hash" VARCHAR(255),
  ADD COLUMN "last_login_at" TIMESTAMP(3),
  ADD COLUMN "download_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "payment_reference" VARCHAR(200);