import { Module } from '@nestjs/common';
import { BlogsController } from './blogs.controller';
import { BlogsService } from './blogs.service';
import { ConfigService } from '@nestjs/config';

@Module({
  controllers: [BlogsController],
  providers: [BlogsService, ConfigService],
})
export class BlogsModule {}
