import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // The pool is sized explicitly rather than left to Prisma's default of
    // num_cpus * 2 + 1 (13 here). Registration is the burst case: a launch-day
    // spike runs many short transactions at once, and the default ceiling sits
    // uncomfortably close to Postgres' own 100 while still being too small to
    // queue. 20 leaves room for the rest of the app and, with a 10s timeout,
    // makes a saturated pool wait and recover rather than fail the request.
    const connectionLimit = Number(process.env.DATABASE_POOL_SIZE ?? 20);

    // Appended rather than baked into the schema so a deployment can retune the
    // pool without a code change. The separator is chosen from whatever the URL
    // already uses — the stored one ends in `?schema=public`, and blindly
    // appending `&connection_limit=` would produce a URL Postgres cannot parse.
    const baseUrl = process.env.DATABASE_URL;
    const url = baseUrl
      ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}connection_limit=${connectionLimit}&pool_timeout=10`
      : undefined;

    super({
      log:
        process.env.NODE_ENV === 'development'
          ? [{ emit: 'event', level: 'query' }, { emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }]
          : [{ emit: 'stdout', level: 'error' }],
      datasources: { db: { url } },
    });

    this.logger.log(`Prisma pool limit: ${connectionLimit}`);
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
