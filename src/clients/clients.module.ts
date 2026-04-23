import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [ConfigModule, DocumentsModule],
  controllers: [ClientsController],
  providers: [ClientsService, ConfigService],
})
export class ClientsModule {}
