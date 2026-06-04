import { Module } from '@nestjs/common';
import { RepaymentsService } from './repayments.service';
import { RepaymentsController } from './repayments.controller';
import { ClientRepaymentsController } from './client-repayments.controller';
import { MomoRepaymentsCallbackController } from './momo-repayments-callback.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { DocumentsModule } from '../documents/documents.module';
import { MomoModule } from '../momo/momo.module';

@Module({
  imports: [NotificationsModule, DocumentsModule, MomoModule],
  controllers: [
    RepaymentsController,
    ClientRepaymentsController,
    MomoRepaymentsCallbackController,
  ],
  providers: [RepaymentsService],
})
export class RepaymentsModule {}
