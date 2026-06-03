import { Module } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { ClientLoansController } from './client-loans.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [NotificationsModule, DocumentsModule],
  controllers: [LoansController, ClientLoansController],
  providers: [LoansService],
})
export class LoansModule {}
