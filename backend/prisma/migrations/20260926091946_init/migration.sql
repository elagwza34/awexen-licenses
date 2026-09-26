-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "AdminRoleKey" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SUPPORT_AGENT', 'FINANCE', 'VIEWER');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FeatureStatus" AS ENUM ('ACTIVE', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "FeatureCategory" AS ENUM ('CORE', 'INVENTORY', 'SALES', 'REPORTING', 'INTEGRATION', 'PLATFORM');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY', 'LIFETIME');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('TRIAL', 'EXPIRING', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ActivationType" AS ENUM ('INITIAL', 'REACTIVATION', 'RENEWAL', 'DEVICE_RESET');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('SUCCESS', 'FAILED', 'EXPIRED', 'SUSPENDED', 'INVALID', 'DEVICE_LIMIT', 'REVOKED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'CARD', 'ONLINE', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TicketMessageType" AS ENUM ('REPLY', 'INTERNAL_NOTE');

-- CreateEnum
CREATE TYPE "AppVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('WINDOWS', 'MACOS', 'LINUX');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');

-- CreateEnum
CREATE TYPE "AuditEntity" AS ENUM ('ADMIN', 'CUSTOMER', 'PLAN', 'FEATURE', 'SUBSCRIPTION', 'LICENSE', 'DEVICE', 'ACTIVATION', 'VALIDATION', 'PAYMENT', 'SUPPORT_TICKET', 'APP_VERSION', 'SETTING');

-- CreateEnum
CREATE TYPE "ProrationMode" AS ENUM ('NONE', 'PRORATED_CREDIT', 'IMMEDIATE_CHARGE');

-- CreateEnum
CREATE TYPE "SettingType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'JSON');

-- CreateTable
CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "resource" VARCHAR(60) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "key" "AdminRoleKey" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(180) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "password_changed_at" TIMESTAMP(3),
    "status" "AdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "phone" VARCHAR(40),
    "avatar_url" VARCHAR(500),
    "locale" VARCHAR(10) NOT NULL DEFAULT 'ar',
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_factor_secret_enc" VARCHAR(512),
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" VARCHAR(64),
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_roles" (
    "adminId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("adminId","roleId")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" SERIAL NOT NULL,
    "admin_id" INTEGER NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "family_id" VARCHAR(64) NOT NULL,
    "user_agent" VARCHAR(400),
    "ip" VARCHAR(64),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" VARCHAR(120),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER,
    "email" VARCHAR(180) NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" VARCHAR(120),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(400),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "features" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "name_ar" VARCHAR(120),
    "description" TEXT,
    "category" "FeatureCategory" NOT NULL DEFAULT 'CORE',
    "status" "FeatureStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "name_ar" VARCHAR(120),
    "description" TEXT,
    "price" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "billing_interval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "max_devices" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_popular" BOOLEAN NOT NULL DEFAULT false,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_trial_plan" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_features" (
    "planId" INTEGER NOT NULL,
    "featureId" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("planId","featureId")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "company" VARCHAR(160),
    "email" VARCHAR(180) NOT NULL,
    "phone" VARCHAR(40),
    "address" TEXT,
    "city" VARCHAR(120),
    "country" VARCHAR(80),
    "tax_number" VARCHAR(60),
    "notes" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" SERIAL NOT NULL,
    "number" VARCHAR(60) NOT NULL,
    "customerId" INTEGER NOT NULL,
    "subscription_id" INTEGER,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "planId" INTEGER NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "billing_interval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
    "auto_renew" BOOLEAN NOT NULL DEFAULT true,
    "price" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "trial_ends_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(400),
    "ended_at" TIMESTAMP(3),
    "proration_mode" "ProrationMode" NOT NULL DEFAULT 'NONE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "licenses" (
    "id" SERIAL NOT NULL,
    "license_key" VARCHAR(64) NOT NULL,
    "customerId" INTEGER NOT NULL,
    "subscriptionId" INTEGER,
    "planId" INTEGER NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "max_devices" INTEGER NOT NULL DEFAULT 1,
    "is_trial" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "last_validation_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "last_activation_at" TIMESTAMP(3),
    "signature" TEXT,
    "payload_hash" VARCHAR(128),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" VARCHAR(400),
    "suspended_at" TIMESTAMP(3),
    "suspended_reason" VARCHAR(400),
    "reissue_of_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" SERIAL NOT NULL,
    "licenseId" INTEGER NOT NULL,
    "device_fingerprint" VARCHAR(128) NOT NULL,
    "device_name" VARCHAR(180),
    "platform" VARCHAR(40),
    "os_version" VARCHAR(80),
    "app_version" VARCHAR(40),
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),
    "last_validation_at" TIMESTAMP(3),
    "last_ip" VARCHAR(64),
    "blocked_at" TIMESTAMP(3),
    "blocked_reason" VARCHAR(300),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activations" (
    "id" SERIAL NOT NULL,
    "licenseId" INTEGER NOT NULL,
    "deviceId" INTEGER,
    "customerId" INTEGER NOT NULL,
    "activation_type" "ActivationType" NOT NULL DEFAULT 'INITIAL',
    "success" BOOLEAN NOT NULL,
    "failure_reason" VARCHAR(200),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(400),
    "app_version" VARCHAR(40),
    "performed_by_id" INTEGER,
    "note" VARCHAR(400),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_validations" (
    "id" SERIAL NOT NULL,
    "licenseId" INTEGER NOT NULL,
    "deviceId" INTEGER,
    "customerId" INTEGER NOT NULL,
    "status" "ValidationStatus" NOT NULL,
    "reason" VARCHAR(200),
    "ip" VARCHAR(64),
    "app_version" VARCHAR(40),
    "latency_ms" INTEGER,
    "valid_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "subscription_id" INTEGER,
    "invoice_id" INTEGER,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "transaction_reference" VARCHAR(120),
    "paid_at" TIMESTAMP(3),
    "refunded_amount" INTEGER NOT NULL DEFAULT 0,
    "refund_reason" VARCHAR(400),
    "notes" TEXT,
    "verified_by_id" INTEGER,
    "verified_at" TIMESTAMP(3),
    "receipt_url" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" SERIAL NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "customerId" INTEGER NOT NULL,
    "licenseId" INTEGER,
    "subject" VARCHAR(300) NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "assigned_admin_id" INTEGER,
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_messages" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "adminId" INTEGER,
    "type" "TicketMessageType" NOT NULL DEFAULT 'REPLY',
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_versions" (
    "id" SERIAL NOT NULL,
    "version" VARCHAR(40) NOT NULL,
    "build_number" INTEGER NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'WINDOWS',
    "channel" VARCHAR(40) NOT NULL DEFAULT 'stable',
    "status" "AppVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "release_notes" TEXT,
    "download_url" VARCHAR(500),
    "checksum" VARCHAR(128),
    "file_size" BIGINT,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "min_supported_version" VARCHAR(40),
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER,
    "admin_email" VARCHAR(180),
    "action" VARCHAR(120) NOT NULL,
    "entity" "AuditEntity" NOT NULL,
    "entity_id" VARCHAR(64),
    "old_value" JSONB,
    "new_value" JSONB,
    "metadata" JSONB,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(400),
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER,
    "customerId" INTEGER,
    "type" VARCHAR(80) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "title" VARCHAR(200) NOT NULL,
    "title_ar" VARCHAR(200),
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "scheduled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "error" VARCHAR(500),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(120) NOT NULL,
    "value" JSONB NOT NULL,
    "type" "SettingType" NOT NULL DEFAULT 'STRING',
    "label" VARCHAR(160),
    "label_ar" VARCHAR(160),
    "group" VARCHAR(60) NOT NULL DEFAULT 'general',
    "description" TEXT,
    "description_ar" VARCHAR(400),
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_id" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "admins_status_idx" ON "admins"("status");

-- CreateIndex
CREATE INDEX "admin_roles_roleId_idx" ON "admin_roles"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_admin_id_revoked_at_idx" ON "refresh_tokens"("admin_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "login_attempts_email_created_at_idx" ON "login_attempts"("email", "created_at");

-- CreateIndex
CREATE INDEX "login_attempts_adminId_created_at_idx" ON "login_attempts"("adminId", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "features_key_key" ON "features"("key");

-- CreateIndex
CREATE INDEX "features_status_category_idx" ON "features"("status", "category");

-- CreateIndex
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");

-- CreateIndex
CREATE INDEX "plans_status_sort_order_idx" ON "plans"("status", "sort_order");

-- CreateIndex
CREATE INDEX "plan_features_featureId_idx" ON "plan_features"("featureId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE INDEX "customers_status_idx" ON "customers"("status");

-- CreateIndex
CREATE INDEX "customers_company_idx" ON "customers"("company");

-- CreateIndex
CREATE INDEX "customers_created_at_idx" ON "customers"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_customerId_issued_at_idx" ON "invoices"("customerId", "issued_at");

-- CreateIndex
CREATE INDEX "subscriptions_customerId_status_idx" ON "subscriptions"("customerId", "status");

-- CreateIndex
CREATE INDEX "subscriptions_status_expires_at_idx" ON "subscriptions"("status", "expires_at");

-- CreateIndex
CREATE INDEX "subscriptions_expires_at_idx" ON "subscriptions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "licenses_license_key_key" ON "licenses"("license_key");

-- CreateIndex
CREATE INDEX "licenses_customerId_status_idx" ON "licenses"("customerId", "status");

-- CreateIndex
CREATE INDEX "licenses_status_expires_at_idx" ON "licenses"("status", "expires_at");

-- CreateIndex
CREATE INDEX "licenses_planId_idx" ON "licenses"("planId");

-- CreateIndex
CREATE INDEX "licenses_expires_at_idx" ON "licenses"("expires_at");

-- CreateIndex
CREATE INDEX "devices_licenseId_status_idx" ON "devices"("licenseId", "status");

-- CreateIndex
CREATE INDEX "devices_last_seen_at_idx" ON "devices"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "devices_licenseId_device_fingerprint_key" ON "devices"("licenseId", "device_fingerprint");

-- CreateIndex
CREATE INDEX "activations_licenseId_created_at_idx" ON "activations"("licenseId", "created_at");

-- CreateIndex
CREATE INDEX "activations_customerId_created_at_idx" ON "activations"("customerId", "created_at");

-- CreateIndex
CREATE INDEX "activations_deviceId_idx" ON "activations"("deviceId");

-- CreateIndex
CREATE INDEX "license_validations_licenseId_created_at_idx" ON "license_validations"("licenseId", "created_at");

-- CreateIndex
CREATE INDEX "license_validations_status_created_at_idx" ON "license_validations"("status", "created_at");

-- CreateIndex
CREATE INDEX "license_validations_customerId_idx" ON "license_validations"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_transaction_reference_key" ON "payments"("transaction_reference");

-- CreateIndex
CREATE INDEX "payments_customerId_created_at_idx" ON "payments"("customerId", "created_at");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "payments_subscription_id_idx" ON "payments"("subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_idx" ON "support_tickets"("status", "priority");

-- CreateIndex
CREATE INDEX "support_tickets_customerId_created_at_idx" ON "support_tickets"("customerId", "created_at");

-- CreateIndex
CREATE INDEX "support_tickets_assigned_admin_id_status_idx" ON "support_tickets"("assigned_admin_id", "status");

-- CreateIndex
CREATE INDEX "support_ticket_messages_ticketId_created_at_idx" ON "support_ticket_messages"("ticketId", "created_at");

-- CreateIndex
CREATE INDEX "app_versions_status_platform_idx" ON "app_versions"("status", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "app_versions_version_build_number_platform_channel_key" ON "app_versions"("version", "build_number", "platform", "channel");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_created_at_idx" ON "audit_logs"("entity", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_adminId_created_at_idx" ON "audit_logs"("adminId", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "notifications_status_scheduled_at_idx" ON "notifications"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "notifications_customerId_idx" ON "notifications"("customerId");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_roles" ADD CONSTRAINT "admin_roles_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_roles" ADD CONSTRAINT "admin_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activations" ADD CONSTRAINT "activations_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activations" ADD CONSTRAINT "activations_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activations" ADD CONSTRAINT "activations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_validations" ADD CONSTRAINT "license_validations_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_validations" ADD CONSTRAINT "license_validations_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_validations" ADD CONSTRAINT "license_validations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_admin_id_fkey" FOREIGN KEY ("assigned_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
