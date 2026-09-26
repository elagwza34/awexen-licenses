import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsBoolean, IsInt, IsNotEmpty, IsString, Max, Min, MinLength } from 'class-validator';
import { Transform, plainToInstance } from 'class-transformer';

/**
 * Environment validation. The app refuses to boot on weak or missing secrets —
 * a misconfigured deployment must fail loudly, not silently weaken security.
 */
class EnvSchema {
  @IsString()
  @IsNotEmpty()
  NODE_ENV: string = 'development';

  @Transform(({ value }) => Number(value))
  @IsInt()
  PORT: number = 4000;

  @IsString()
  @IsNotEmpty()
  API_PREFIX: string = 'api/v1';

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  @IsNotEmpty()
  JWT_ACCESS_SECRET!: string;

  @IsString()
  JWT_ACCESS_TTL: string = '15m';

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(365)
  JWT_REFRESH_TTL_DAYS: number = 30;

  @IsString()
  PASSWORD_PEPPER: string = '';

  @IsString()
  @IsNotEmpty()
  LICENSE_PRIVATE_KEY_PATH: string = 'keys/license-private.pem';

  @IsString()
  @IsNotEmpty()
  LICENSE_PUBLIC_KEY_PATH: string = 'keys/license-public.pem';

  @IsString()
  LICENSE_KEY_PREFIX: string = 'PROD';

  @IsString()
  CORS_ORIGINS: string = 'http://localhost:5173';

  /// Public hostname, e.g. `admin.example.com`. Nginx substitutes it into
  /// `server_name` at container start; production refuses to boot without it.
  @IsString()
  SERVER_NAME: string = 'admin.example.com';

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  TRUST_PROXY: boolean = false;
}

export function validateEnv(config: Record<string, unknown>): EnvSchema {
  const validated = plainToInstance(EnvSchema, config, {
    exposeDefaultValues: true,
  });

  const errors: string[] = validatedErrors(validated);

  // Hard requirements that must never be satisfied by a default value.
  if (!config.DATABASE_URL) {
    errors.push('DATABASE_URL is required');
  }
  if (!config.JWT_ACCESS_SECRET || String(config.JWT_ACCESS_SECRET).length < 32) {
    errors.push('JWT_ACCESS_SECRET must be set and at least 32 characters long');
  }
  if (String(config.NODE_ENV) === 'production') {
    if (!config.PASSWORD_PEPPER || String(config.PASSWORD_PEPPER).length < 16) {
      errors.push('PASSWORD_PEPPER (min 16 chars) is required in production');
    }
    if (!config.CORS_ORIGINS || config.CORS_ORIGINS === 'http://localhost:5173') {
      errors.push('CORS_ORIGINS must list the real frontend origins in production');
    }
    if (!config.SERVER_NAME || config.SERVER_NAME === 'admin.example.com') {
      errors.push('SERVER_NAME must be the real hostname in production');
    }
  }

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n - ${errors.join('\n - ')}`);
  }

  return validated;
}

function validatedErrors(validated: EnvSchema): string[] {
  const errors: string[] = [];
  const schema = [
    { key: 'NODE_ENV', value: validated.NODE_ENV },
    { key: 'PORT', value: validated.PORT },
    { key: 'API_PREFIX', value: validated.API_PREFIX },
    { key: 'DATABASE_URL', value: validated.DATABASE_URL },
    { key: 'JWT_ACCESS_SECRET', value: validated.JWT_ACCESS_SECRET },
    { key: 'JWT_ACCESS_TTL', value: validated.JWT_ACCESS_TTL },
    { key: 'JWT_REFRESH_TTL_DAYS', value: validated.JWT_REFRESH_TTL_DAYS },
    { key: 'LICENSE_PRIVATE_KEY_PATH', value: validated.LICENSE_PRIVATE_KEY_PATH },
    { key: 'LICENSE_PUBLIC_KEY_PATH', value: validated.LICENSE_PUBLIC_KEY_PATH },
    { key: 'LICENSE_KEY_PREFIX', value: validated.LICENSE_KEY_PREFIX },
    { key: 'CORS_ORIGINS', value: validated.CORS_ORIGINS },
  ];

  for (const field of schema) {
    if (field.value === undefined || field.value === null || field.value === '') {
      errors.push(`${field.key} is required`);
    }
  }
  return errors;
}

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  get corsOrigins(): string[] {
    return this.config
      .get<string>('CORS_ORIGINS', 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  get pepper(): string {
    return this.config.get<string>('PASSWORD_PEPPER', '');
  }

  get refreshTtlDays(): number {
    return Number(this.config.get('JWT_REFRESH_TTL_DAYS', 30));
  }

  get licenseKeyPrefix(): string {
    return this.config.get<string>('LICENSE_KEY_PREFIX', 'PROD');
  }
}
