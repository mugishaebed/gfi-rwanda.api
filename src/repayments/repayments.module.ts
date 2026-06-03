import { Module } from '@nestjs/common';
import { RepaymentsService } from './repayments.service';
import { RepaymentsController } from './repayments.controller';
import { ClientRepaymentsController } from './client-repayments.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [NotificationsModule, DocumentsModule],
  controllers: [RepaymentsController, ClientRepaymentsController],
  providers: [RepaymentsService],
})
export class RepaymentsModule {}
