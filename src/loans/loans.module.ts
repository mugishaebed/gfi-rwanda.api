import { Module } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { PrismaService } from 'src/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [LoansController],
  providers: [LoansService, PrismaService],
})
export class LoansModule {}
