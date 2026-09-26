/**
 * Seeds the RBAC catalogue, the feature catalogue, the default plans, the
 * runtime settings and the first SUPER_ADMIN.
 *
 * Safe to re-run: every write is an upsert keyed on a natural unique column.
 *
 *   npm run prisma:seed
 *
 * Plan prices are seeded as 0 on purpose — set real prices from the Plans
 * screen before selling. Seeding invented prices would be fabricating data.
 */
import { PrismaClient, AdminRoleKey, SettingType, FeatureCategory } from '@prisma/client';
import * as argon2 from 'argon2';
import * as dotenv from 'dotenv';

dotenv.config({ path: process.env.ENV_FILE ?? '.env' });

const prisma = new PrismaClient();

/** Dotted permission keys, grouped by resource. */
const PERMISSIONS: Array<{ key: string; resource: string; description: string }> = [
  { key: 'admins.view', resource: 'admins', description: 'View admin accounts and roles' },
  { key: 'admins.create', resource: 'admins', description: 'Create admin accounts' },
  { key: 'admins.update', resource: 'admins', description: 'Update admin accounts' },
  { key: 'admins.delete', resource: 'admins', description: 'Deactivate admin accounts' },

  { key: 'customers.view', resource: 'customers', description: 'View customers' },
  { key: 'customers.create', resource: 'customers', description: 'Create customers' },
  { key: 'customers.update', resource: 'customers', description: 'Update customers' },
  { key: 'customers.delete', resource: 'customers', description: 'Archive customers' },

  { key: 'plans.view', resource: 'plans', description: 'View plans' },
  { key: 'plans.create', resource: 'plans', description: 'Create plans' },
  { key: 'plans.update', resource: 'plans', description: 'Update plans' },
  { key: 'plans.delete', resource: 'plans', description: 'Archive or delete plans' },

  { key: 'features.view', resource: 'features', description: 'View features' },
  { key: 'features.create', resource: 'features', description: 'Create features' },
  { key: 'features.update', resource: 'features', description: 'Update features' },
  { key: 'features.delete', resource: 'features', description: 'Deprecate or delete features' },

  { key: 'subscriptions.view', resource: 'subscriptions', description: 'View subscriptions' },
  { key: 'subscriptions.create', resource: 'subscriptions', description: 'Create subscriptions' },
  { key: 'subscriptions.update', resource: 'subscriptions', description: 'Update subscriptions' },

  { key: 'licenses.view', resource: 'licenses', description: 'View licenses' },
  { key: 'licenses.create', resource: 'licenses', description: 'Issue licenses' },
  { key: 'licenses.update', resource: 'licenses', description: 'Update and renew licenses' },
  { key: 'licenses.suspend', resource: 'licenses', description: 'Suspend licenses' },
  { key: 'licenses.revoke', resource: 'licenses', description: 'Revoke licenses' },
  { key: 'licenses.activate', resource: 'licenses', description: 'Reactivate suspended licenses' },

  { key: 'devices.view', resource: 'devices', description: 'View devices' },
  { key: 'devices.reset', resource: 'devices', description: 'Reset or block devices' },

  { key: 'activations.view', resource: 'activations', description: 'View activation history' },
  { key: 'validations.view', resource: 'validations', description: 'View validation history' },

  { key: 'payments.view', resource: 'payments', description: 'View payments' },
  { key: 'payments.verify', resource: 'payments', description: 'Verify payments' },
  { key: 'payments.refund', resource: 'payments', description: 'Refund payments' },
  { key: 'payments.create', resource: 'payments', description: 'Record manual payments' },

  { key: 'support.view', resource: 'support', description: 'View support tickets' },
  { key: 'support.update', resource: 'support', description: 'Reply to and update tickets' },

  { key: 'releases.view', resource: 'releases', description: 'View application versions' },
  { key: 'releases.create', resource: 'releases', description: 'Create application versions' },
  { key: 'releases.publish', resource: 'releases', description: 'Publish versions' },

  { key: 'analytics.view', resource: 'analytics', description: 'View system analytics' },
  { key: 'audit.view', resource: 'audit', description: 'View the audit trail' },
  { key: 'settings.view', resource: 'settings', description: 'View settings' },
  { key: 'settings.update', resource: 'settings', description: 'Change settings' },
];

type RoleDefinition = {
  key: AdminRoleKey;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[] | 'ALL';
};

const VIEWER_PERMS = PERMISSIONS.filter((p) => p.key.endsWith('.view')).map((p) => p.key);

const ROLES: RoleDefinition[] = [
  {
    key: AdminRoleKey.SUPER_ADMIN,
    name: 'Super Administrator',
    description: 'Unrestricted access. Every action is still audited.',
    isSystem: true,
    permissions: 'ALL',
  },
  {
    key: AdminRoleKey.ADMIN,
    name: 'Administrator',
    description: 'Full operational control except role and settings management.',
    isSystem: true,
    permissions: PERMISSIONS.filter(
      (p) => !['admins.create', 'admins.delete', 'settings.update'].includes(p.key),
    ).map((p) => p.key),
  },
  {
    key: AdminRoleKey.SUPPORT_AGENT,
    name: 'Support Agent',
    description: 'Handles customers, licenses and tickets. No financial access.',
    isSystem: true,
    permissions: [
      'customers.view', 'subscriptions.view', 'licenses.view', 'devices.view',
      'devices.reset', 'activations.view', 'validations.view',
      'support.view', 'support.update', 'releases.view',
    ],
  },
  {
    key: AdminRoleKey.FINANCE,
    name: 'Finance',
    description: 'Payments, invoices and revenue reporting.',
    isSystem: true,
    permissions: [
      'customers.view', 'subscriptions.view', 'payments.view', 'payments.verify',
      'payments.refund', 'payments.create', 'analytics.view',
    ],
  },
  {
    key: AdminRoleKey.VIEWER,
    name: 'Viewer',
    description: 'Read-only access across the panel.',
    isSystem: true,
    permissions: VIEWER_PERMS,
  },
];

const FEATURES: Array<{ key: string; name: string; nameAr: string; category: FeatureCategory }> = [
  { key: 'PRODUCTS', name: 'Products', nameAr: 'المنتجات', category: 'CORE' },
  { key: 'INVENTORY', name: 'Inventory', nameAr: 'المخزون', category: 'INVENTORY' },
  { key: 'SALES', name: 'Sales', nameAr: 'المبيعات', category: 'SALES' },
  { key: 'PURCHASES', name: 'Purchases', nameAr: 'المشتريات', category: 'INVENTORY' },
  { key: 'POS', name: 'Point of Sale', nameAr: 'نقطة البيع', category: 'SALES' },
  { key: 'REPORTS', name: 'Reports', nameAr: 'التقارير', category: 'REPORTING' },
  { key: 'MULTI_WAREHOUSE', name: 'Multi Warehouse', nameAr: 'مستودعات متعددة', category: 'INVENTORY' },
  { key: 'WOOCOMMERCE', name: 'WooCommerce', nameAr: 'ووكومرس', category: 'INTEGRATION' },
  { key: 'ADVANCED_REPORTS', name: 'Advanced Reports', nameAr: 'تقارير متقدمة', category: 'REPORTING' },
  { key: 'EXPORT', name: 'Data Export', nameAr: 'تصدير البيانات', category: 'PLATFORM' },
  { key: 'API_ACCESS', name: 'API Access', nameAr: 'الوصول عبر API', category: 'PLATFORM' },
];

const PLANS = [
  {
    key: 'BASIC', name: 'Basic', nameAr: 'أساسي', trialDays: 14, maxDevices: 1, sortOrder: 1,
    features: ['PRODUCTS', 'INVENTORY', 'SALES'],
  },
  {
    key: 'PROFESSIONAL', name: 'Professional', nameAr: 'احترافي', trialDays: 14, maxDevices: 3, sortOrder: 2,
    isPopular: true,
    features: ['PRODUCTS', 'INVENTORY', 'SALES', 'PURCHASES', 'REPORTS', 'POS', 'EXPORT'],
  },
  {
    key: 'BUSINESS', name: 'Business', nameAr: 'أعمال', trialDays: 0, maxDevices: 10, sortOrder: 3,
    features: [
      'PRODUCTS', 'INVENTORY', 'SALES', 'PURCHASES', 'REPORTS', 'POS', 'EXPORT',
      'MULTI_WAREHOUSE', 'WOOCOMMERCE', 'ADVANCED_REPORTS', 'API_ACCESS',
    ],
  },
];

const SETTINGS: Array<{
  key: string; value: string | number | boolean; type: SettingType;
  label: string; labelAr: string; group: string; description: string;
}> = [
  { key: 'company.name', value: 'Software Company', type: SettingType.STRING, label: 'Company name', labelAr: 'اسم الشركة', group: 'company', description: 'Shown in the panel and on invoices' },
  { key: 'company.email', value: 'support@company.com', type: SettingType.STRING, label: 'Company email', labelAr: 'بريد الشركة', group: 'company', description: 'Support contact address' },
  { key: 'company.phone', value: '', type: SettingType.STRING, label: 'Company phone', labelAr: 'هاتف الشركة', group: 'company', description: 'Support contact number' },
  { key: 'billing.default_currency', value: 'EGP', type: SettingType.STRING, label: 'Default currency', labelAr: 'العملة الافتراضية', group: 'billing', description: 'ISO currency code for new plans and payments' },
  { key: 'license.validation_interval_hours', value: 72, type: SettingType.NUMBER, label: 'Validation interval (hours)', labelAr: 'فترة التحقق (ساعات)', group: 'license', description: 'How long the customer app may run without re-validating' },
  { key: 'license.grace_period_days', value: 7, type: SettingType.NUMBER, label: 'Grace period (days)', labelAr: 'فترة السماح (أيام)', group: 'license', description: 'Days a licence keeps working after it expires' },
  { key: 'license.expiring_window_days', value: 14, type: SettingType.NUMBER, label: 'Expiring warning (days)', labelAr: 'تحذير الانتهاء (أيام)', group: 'license', description: 'Licences inside this window are flagged EXPIRING' },
  { key: 'license.default_max_devices', value: 1, type: SettingType.NUMBER, label: 'Default max devices', labelAr: 'الحد الافتراضي للأجهزة', group: 'license', description: 'Device slots when a plan does not specify a limit' },
  { key: 'trial.default_days', value: 14, type: SettingType.NUMBER, label: 'Default trial days', labelAr: 'أيام التجربة الافتراضية', group: 'license', description: 'Trial length when a plan does not specify one' },
  { key: 'trial.default_plan_key', value: 'BASIC', type: SettingType.STRING, label: 'Default trial plan', labelAr: 'خطة التجربة الافتراضية', group: 'license', description: 'Plan key used when starting a trial' },
  { key: 'security.session_timeout_hours', value: 12, type: SettingType.NUMBER, label: 'Session timeout (hours)', labelAr: 'مهلة الجلسة (ساعات)', group: 'security', description: 'Idle time before an admin must sign in again' },
  { key: 'security.require_two_factor', value: false, type: SettingType.BOOLEAN, label: 'Require 2FA', labelAr: 'طلب التحقق بخطوتين', group: 'security', description: 'Force every admin except the owner to enable 2FA' },
  { key: 'notifications.expiry_warning_days', value: 7, type: SettingType.NUMBER, label: 'Expiry warning (days)', labelAr: 'تنبيه الانتهاء (أيام)', group: 'notifications', description: 'How far ahead to warn customers about expiry' },
  { key: 'notifications.payment_followup_days', value: 3, type: SettingType.NUMBER, label: 'Payment follow-up (days)', labelAr: 'متابعة الدفع (أيام)', group: 'notifications', description: 'Days before following up on a pending payment' },
  { key: 'system.timezone', value: 'Africa/Cairo', type: SettingType.STRING, label: 'Timezone', labelAr: 'المنطقة الزمنية', group: 'system', description: 'Timezone used for reports and notifications' },
];

async function main() {
  console.log('Seeding permissions…');
  const permissionMap = new Map<string, number>();
  for (const permission of PERMISSIONS) {
    const record = await prisma.permission.upsert({
      where: { key: permission.key },
      update: { resource: permission.resource, description: permission.description },
      create: permission,
    });
    permissionMap.set(permission.key, record.id);
  }

  console.log('Seeding roles…');
  for (const role of ROLES) {
    const record = await prisma.role.upsert({
      where: { key: role.key },
      update: { name: role.name, description: role.description, isSystem: role.isSystem },
      create: { key: role.key, name: role.name, description: role.description, isSystem: role.isSystem },
    });

    const keys = role.permissions === 'ALL' ? PERMISSIONS.map((p) => p.key) : role.permissions;
    await prisma.rolePermission.deleteMany({ where: { roleId: record.id } });
    await prisma.rolePermission.createMany({
      data: keys.map((key) => ({ roleId: record.id, permissionId: permissionMap.get(key)! })),
      skipDuplicates: true,
    });
    console.log(`  ${role.key}: ${keys.length} permission(s)`);
  }

  console.log('Seeding features…');
  const featureMap = new Map<string, number>();
  for (const feature of FEATURES) {
    const record = await prisma.feature.upsert({
      where: { key: feature.key },
      update: { name: feature.name, nameAr: feature.nameAr, category: feature.category },
      create: feature,
    });
    featureMap.set(feature.key, record.id);
  }

  console.log('Seeding plans…');
  for (const plan of PLANS) {
    const record = await prisma.plan.upsert({
      where: { key: plan.key },
      update: {
        name: plan.name,
        nameAr: plan.nameAr,
        maxDevices: plan.maxDevices,
        sortOrder: plan.sortOrder,
      },
      create: {
        key: plan.key,
        name: plan.name,
        nameAr: plan.nameAr,
        price: 0,
        currency: 'EGP',
        billingInterval: 'MONTHLY',
        trialDays: plan.trialDays,
        maxDevices: plan.maxDevices,
        sortOrder: plan.sortOrder,
        isPopular: Boolean(plan.isPopular),
      },
    });

    await prisma.planFeature.deleteMany({ where: { planId: record.id } });
    await prisma.planFeature.createMany({
      data: plan.features.map((key) => ({ planId: record.id, featureId: featureMap.get(key)! })),
    });
    console.log(`  ${plan.key}: ${plan.features.length} feature(s)`);
  }

  console.log('Seeding settings…');
  for (const setting of SETTINGS) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: {
        label: setting.label,
        labelAr: setting.labelAr,
        group: setting.group,
        description: setting.description,
      },
      create: setting,
    });
  }

  await seedOwner();
  console.log('\nSeed complete.');
}

async function seedOwner() {
  console.log('Seeding the first SUPER_ADMIN…');
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'owner@company.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password || password.length < 12) {
    console.warn('  SEED_ADMIN_PASSWORD is not set or is shorter than 12 characters — skipping admin creation.');
    console.warn('  Set it in .env and run `npm run prisma:seed` again to create the owner account.');
    return;
  }

  const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { key: AdminRoleKey.SUPER_ADMIN } });

  // The hash MUST be produced exactly the way SecurityService.hashPassword does
  // it, pepper included — otherwise verifyPassword() can never match it and the
  // seeded owner silently cannot sign in.
  const pepper = process.env.PASSWORD_PEPPER ?? '';
  const salted = pepper ? `${password}::${pepper}` : password;

  const hash = await argon2.hash(salted, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const admin = await prisma.admin.upsert({
    where: { email },
    // Re-hash on every seed run so a fix to the hashing scheme (or a changed
    // pepper) actually takes effect instead of leaving a stale unusable hash.
    update: { passwordHash: hash },
    create: {
      email,
      name: process.env.SEED_ADMIN_NAME ?? 'Software Owner',
      passwordHash: hash,
      status: 'ACTIVE',
    },
  });

  await prisma.adminRole.upsert({
    where: { adminId_roleId: { adminId: admin.id, roleId: superAdminRole.id } },
    update: {},
    create: { adminId: admin.id, roleId: superAdminRole.id },
  });

  console.log(`  SUPER_ADMIN ready: ${email}`);
  console.log('  Change this password immediately after the first sign-in.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });



