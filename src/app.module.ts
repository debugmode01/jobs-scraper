import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from 'nestjs-pino';
import { UsersModule } from './modules/users/users.module';
import { BrowserModule } from './modules/browser/browser.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: [`.env`],
      isGlobal: true,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport: {
          targets: [
            {
              target: 'pino-pretty',
              level: 'debug',
              options: {
                colorize: true,
                translateTime: 'SYS:HH:MM:ss',
                singleLine: false,
                ignore: 'pid,hostname',
              },
            },
            {
              target: 'pino/file',
              level: 'debug',
              options: {
                destination: './logs/app.log',
                mkdir: true,
              },
            },
          ],
        },
        autoLogging: process.env.NODE_ENV !== 'development',
      },
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    UsersModule,
    BrowserModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
