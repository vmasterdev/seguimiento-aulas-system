import 'reflect-metadata';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  logger.log('Inicializando API...');
  const app = await NestFactory.create(AppModule, { cors: true });
  logger.log('Nest app creada.');
  app.enableShutdownHooks();
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}`);
}
bootstrap();
