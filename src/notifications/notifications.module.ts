import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [ConfigModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PrismaService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
