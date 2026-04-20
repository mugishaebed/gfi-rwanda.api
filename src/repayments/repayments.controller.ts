import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RepaymentStatus } from '../generated/prisma/enums';
import { RepaymentsService } from './repayments.service';
import { CreateRepaymentDto } from './dto/create-repayment.dto';
import { ReviewRepaymentDto } from './dto/review-repayment.dto';
import { createDocumentUploadOptions } from '../documents/document-upload';

type AuthenticatedRequest = {
  user: {
    userId: string;
  };
};

@ApiTags('Repayments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('repayments')
export class RepaymentsController {
  constructor(private readonly repaymentsService: RepaymentsService) {}

  @Roles('LOAN_OFFICER', 'GENERAL_MANAGER')
  @Get()
  @ApiOperation({ summary: 'Retrieve repayments with pagination' })
  @ApiQuery({
    name: 'page',
    required: false,
    example: 1,
    description: 'Page number to retrieve.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 10,
    description: 'Maximum number of records per page.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: RepaymentStatus,
    description: 'Optional repayment status filter.',
  })
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('status', new ParseEnumPipe(RepaymentStatus, { optional: true }))
    status?: RepaymentStatus,
  ) {
    return this.repaymentsService.findAll(page, limit, status);
  }

  @Roles('LOAN_OFFICER', 'GENERAL_MANAGER')
  @Get(':id')
  @ApiOperation({ summary: 'Retrieve a single repayment' })
  findOne(@Param('id') id: string) {
    return this.repaymentsService.findOne(id);
  }

  @Roles('LOAN_OFFICER')
  @Post()
  @UseInterceptors(
    FilesInterceptor('documents', 10, createDocumentUploadOptions(10 * 1024 * 1024)),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Record a manual repayment as loan officer with pending status',
  })
  createManualRepayment(
    @Body() dto: CreateRepaymentDto,
    @UploadedFiles() files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.repaymentsService.createManualRepayment(
      dto,
      req.user.userId,
      files,
    );
  }

  @Roles('GENERAL_MANAGER')
  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a pending repayment as general manager' })
  approveRepayment(@Param('id') id: string, @Body() dto: ReviewRepaymentDto) {
    return this.repaymentsService.approveRepayment(id, dto);
  }

  @Roles('GENERAL_MANAGER')
  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a pending repayment as general manager' })
  rejectRepayment(@Param('id') id: string, @Body() dto: ReviewRepaymentDto) {
    return this.repaymentsService.rejectRepayment(id, dto);
  }
}
