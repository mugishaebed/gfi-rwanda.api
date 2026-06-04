import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MomoCollectionsService } from './momo-collections.service';
import { MomoDisbursementsService } from './momo-disbursements.service';

@Module({
  imports: [ConfigModule],
  providers: [MomoCollectionsService, MomoDisbursementsService],
  exports: [MomoCollectionsService, MomoDisbursementsService],
})
export class MomoModule {}
