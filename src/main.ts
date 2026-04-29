import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (process.env.NODE_ENV === 'development') {
    const config = new DocumentBuilder()
      .setTitle('GFI Rwanda API')
      .setDescription('Development API reference')
      .setVersion('v1')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);

    app.use(
      '/docs',
      apiReference({
        content: document,
      }),
    );
    app.enableCors({
      origin: '*',
    });
  }
  if (process.env.NODE_ENV === 'production') {
    app.enableCors({
      origin: process.env.FRONTEND_URL,
    });
  }

  await app.listen(process.env.PORT ?? 4000);
}

void bootstrap();
