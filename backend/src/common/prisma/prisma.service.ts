import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? [{ emit: 'event', level: 'query' }, { emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }]
          : [{ emit: 'stdout', level: 'error' }],
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Database connection established');
    } catch (error) {
      // Do not crash-loop the whole process on a transient DB outage: the
      // health endpoint must stay reachable so orchestrators and the owner can
      // see what is wrong. In production the process should fail fast instead.
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('Database connection failed — refusing to start', error as Error);
        throw error;
      }
      this.logger.warn(
        `Database connection failed (${(error as Error).message}). Starting in degraded mode; ` +
          'database-backed endpoints will return 500 until the database is reachable.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Disconnecting a client that never connected would throw; ignore it.
    await this.$disconnect().catch(() => undefined);
  }

  /** Cheap liveness probe used by /api/v1/health. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
