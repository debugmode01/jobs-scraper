import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: true,
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const configService: ConfigService = app.get(ConfigService);

  const config = new DocumentBuilder()
    .setTitle('Jobs Scraper API')
    .setDescription('Jobs Scraper API description')
    .setVersion('1.0')
    .addTag('Jobs Scraper')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addServer("/")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('documentation', app, document);

  const port = configService.get<string>("PORT") || '6000';

  await app.listen(port);
  app.enableCors();

  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Documentation is running on: http://localhost:${port}/documentation`);
}
bootstrap();