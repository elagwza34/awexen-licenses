CREATE TABLE "registration_verifications" (
    "email" VARCHAR(180) PRIMARY KEY,
    "digest" VARCHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "resend_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "registration_verifications_expires_at_idx" ON "registration_verifications"("expires_at");

CREATE TABLE "customer_emails" (
    "id" VARCHAR(100) PRIMARY KEY,
    "email" VARCHAR(180) NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3)
);
CREATE INDEX "customer_emails_sent_at_available_at_idx" ON "customer_emails"("sent_at", "available_at");

ALTER TABLE "registration_verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_emails" ENABLE ROW LEVEL SECURITY;
