import {
  Controller,
  Get,
  Param,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Readable } from 'stream';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DocumentsService } from './documents.service';

type File = {
  stream: Readable;
  mimeType: string;
  originalFileName: string;
};

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Roles('LOAN_OFFICER', 'GENERAL_MANAGER')
  @Get(':id/download')
  @ApiOperation({ summary: 'Download a stored document' })
  async downloadDocument(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file: File = await this.documentsService.getDocumentForDownload(id);

    response.setHeader('Content-Type', file.mimeType);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${file.originalFileName}"`,
    );

    return new StreamableFile(file.stream);
  }
}
