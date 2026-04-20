import { Module } from '@nestjs/common';
import { RepaymentsService } from './repayments.service';
import { RepaymentsController } from './repayments.controller';
import { PrismaService } from '../prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [RepaymentsController],
  providers: [RepaymentsService, PrismaService],
})
export class RepaymentsModule {}
