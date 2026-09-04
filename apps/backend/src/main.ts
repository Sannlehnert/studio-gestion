import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './common/http/configure-app';
import { getSettings } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  await configureApp(app);
  app.enableShutdownHooks();
  const settings = getSettings(app.get(ConfigService));
  await app.listen(settings.port);
  Logger.log('Backend iniciado en puerto ' + settings.port, 'Bootstrap');
}
void bootstrap().catch(() => {
  Logger.error(
    'No se pudo iniciar el backend; revisar configuración y disponibilidad de PostgreSQL',
    'Bootstrap',
  );
  process.exitCode = 1;
});
