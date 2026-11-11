import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { SettingsService } from './settings/settings.service';
import { jsonBigIntReplacer } from './common/json-bigint';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');
  // File sizes from Prisma are BigInt, including portal overview/download and
  // admin release responses. Keep JSON valid without losing large integers.
  app.getHttpAdapter().getInstance().set('json replacer', jsonBigIntReplacer);

  // Required for correct req.ip behind the reverse proxy.
  if (String(config.get('TRUST_PROXY')) === 'true') {
    // NestApplication wraps the platform app, which is the Express instance.
    const expressApp = app.getHttpAdapter().getInstance() as { set: (key: string, value: number) => void };
    expressApp.set('trust proxy', 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: false, // the SPA is served separately by Nginx
      crossOriginEmbedderPolicy: false,
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    }),
  );
  app.use(cookieParser());

  app.enableCors({
    origin: ['https://awexen.com', 'https://www.awexen.com', ...config
      .get<string>('CORS_ORIGINS', 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())],
    credentials: true, // required for the refresh-token cookie
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 3600,
  });

  app.setGlobalPrefix(config.get<string>('API_PREFIX', 'api/v1'));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties — blocks mass-assignment
      forbidNonWhitelisted: true, // reject unknown properties loudly
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger is exposed for local development only.
  if (config.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Owner Admin Panel API')
      .setDescription('Central control centre for the commercial licensing system')
      .setVersion('1.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addCookieAuth('owner_rt')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  app.enableShutdownHooks();

  // Load tunable business rules (validation interval, grace period) on boot.
  try {
    await app.get(SettingsService).applyRuntimeSettings();
  } catch (error) {
    logger.warn('Could not load runtime settings at startup — fallbacks will be used');
  }

  const port = config.get<number>('PORT', 4000);
  await app.listen(port, '0.0.0.0');

  logger.log(`Owner Admin API listening on port ${port}`);
  logger.log(`API prefix: /${config.get('API_PREFIX', 'api/v1')}`);
  logger.warn('The license signing private key is loaded in memory and never leaves the server.');
}

bootstrap();
