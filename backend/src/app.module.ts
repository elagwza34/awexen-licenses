import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditLogsModule } from './audit/audit-logs.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './common/audit/audit.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { CustomerPortalModule } from './customer-portal/customer-portal.module';
import { HealthController } from './common/health.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { PrismaModule } from './common/prisma/prisma.module';
import { validateEnv } from './config/env.validation';
import { CustomersModule } from './customers/customers.module';
import { DevicesModule } from './devices/devices.module';
import { LicensesModule } from './licenses/licenses.module';
import { PaymentsModule } from './payments/payments.module';
import { PlansModule } from './plans/plans.module';
import { ReleasesModule } from './releases/releases.module';
import { SettingsModule } from './settings/settings.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { SupportModule } from './support/support.module';

/** Adds a request id so a UI error can be traced to a server log line. */
function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers['x-request-id'] as string) || randomUUID();
  (req as Request & { requestId?: string }).requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

/**
 * Absolute paths to the environment files.
 *
 * ConfigModule resolves relative `envFilePath` entries against the process
 * working directory, which varies between `node dist/main`, `ts-node src/main`
 * and an IDE launch. Resolving from this file's location makes startup
 * deterministic regardless of how the process was started.
 */
const ENV_FILES = [
  resolve(__dirname, '..', '..', '.env'), // backend/.env
  resolve(__dirname, '..', '..', '..', '.env'), // owner-admin/.env (shared)
  resolve(process.cwd(), '.env'),
].filter((path) => existsSync(path));

if (ENV_FILES.length === 0) {
  // eslint-disable-next-line no-console
  console.warn(
    '[Config] No .env file found. Set the environment variables directly ' +
      '(DATABASE_URL, JWT_ACCESS_SECRET, PASSWORD_PEPPER, …) before starting.',
  );
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ENV_FILES,
      validate: validateEnv,
      cache: true,
    }),

    // Global rate limiting. The auth endpoints apply stricter per-route limits.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 300 },
    ]),

    ScheduleModule.forRoot(),

    PrismaModule,
    AuditModule,
    CryptoModule,
    AuthModule,
    CustomersModule,
    PlansModule,
    SubscriptionsModule,
    LicensesModule,
    AnalyticsModule,
    AuditLogsModule,
    SettingsModule,
    PaymentsModule,
    DevicesModule,
    SupportModule,
    ReleasesModule,
    CustomerPortalModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: authenticate, then authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(requestIdMiddleware).forRoutes('*');
  }
}
