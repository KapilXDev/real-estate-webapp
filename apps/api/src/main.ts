import "reflect-metadata";

import { loadEnvFile } from "./config/load-env";

// Must run before any module reads process.env (configuration.ts validates at import-time of the
// DI factory, which happens during NestFactory.create below).
loadEnvFile();

import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";

import { AppModule } from "./app.module";
import { APP_CONFIG, type AppConfig } from "./config/configuration";

/**
 * API bootstrap.
 *
 * Configuration is validated inside DatabaseModule's provider factory, so a missing JWT secret or
 * database URL aborts startup here rather than surfacing on the first request.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger("Bootstrap");
  // Typed as the Express application specifically — `set("trust proxy")` below is an Express API
  // and is not on the platform-agnostic INestApplication interface.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  const config = app.get<AppConfig>(APP_CONFIG);

  app.use(helmet());

  /*
   * Needed for req.ip to reflect x-forwarded-for behind a reverse proxy. Without it every client
   * looks like the proxy, which would collapse per-IP rate limiting into a single global bucket —
   * one abusive client would then lock out everyone.
   */
  app.set("trust proxy", 1);


  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip unknown properties instead of trusting them.
      whitelist: true,
      // ...and reject outright when they are present, so a typo'd field name fails loudly rather
      // than being silently ignored and appearing to work.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.setGlobalPrefix("api");
  app.enableShutdownHooks();

  await app.listen(config.PORT);
  logger.log(`API listening on port ${config.PORT} (${config.NODE_ENV})`);
}

void bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console -- the logger may not exist yet if boot failed early
  console.error("Failed to start API:", error instanceof Error ? error.message : error);
  process.exit(1);
});
