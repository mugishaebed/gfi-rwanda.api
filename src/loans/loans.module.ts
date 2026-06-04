import { Module } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { ClientLoansController } from './client-loans.controller';
import { MomoLoansCallbackController } from './momo-loans-callback.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { DocumentsModule } from '../documents/documents.module';
import { MomoModule } from '../momo/momo.module';

@Module({
  imports: [NotificationsModule, DocumentsModule, MomoModule],
  controllers: [LoansController, ClientLoansController, MomoLoansCallbackController],
  providers: [LoansService],
})
export class LoansModule {}
