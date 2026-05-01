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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { LoanStatus } from '../generated/prisma/enums';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { ReviewLoanDto } from './dto/review-loan.dto';
import { createDocumentUploadOptions } from '../documents/document-upload';

type AuthenticatedRequest = {
  user: {
    userId: string;
    email: string;
    roles: string[];
  };
};

@ApiTags('Loans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Roles('LOAN_OFFICER', 'GENERAL_MANAGER')
  @Get()
  @ApiOperation({ summary: 'Retrieve loans with pagination' })
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
    enum: LoanStatus,
    description: 'Optional loan status filter.',
  })
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('status', new ParseEnumPipe(LoanStatus, { optional: true }))
    status?: LoanStatus,
  ) {
    return this.loansService.findAll(page, limit, status);
  }

  @Roles('CLIENT')
  @Get('my')
  @ApiOperation({ summary: 'Retrieve current client loans with pagination' })
  findMyLoans(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('status', new ParseEnumPipe(LoanStatus, { optional: true }))
    status: LoanStatus | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.loansService.findMyLoans(req.user.email, page, limit, status);
  }

  @Roles('LOAN_OFFICER', 'GENERAL_MANAGER')
  @Get(':id')
  @ApiOperation({ summary: 'Retrieve a single loan with review history' })
  findOne(@Param('id') id: string) {
    return this.loansService.findOne(id);
  }

  @Roles('CLIENT')
  @Post('request')
  @UseInterceptors(
    FilesInterceptor(
      'documents',
      10,
      createDocumentUploadOptions(10 * 1024 * 1024),
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Create a loan request as client for loan officer review',
  })
  requestLoan(
    @Body() dto: CreateLoanDto,
    @UploadedFiles()
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.loansService.requestLoanAsClient(
      dto,
      req.user.userId,
      req.user.email,
      files,
    );
  }

  @Roles('LOAN_OFFICER')
  @Post()
  @UseInterceptors(
    FilesInterceptor(
      'documents',
      10,
      createDocumentUploadOptions(10 * 1024 * 1024),
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Create a loan on behalf of client as loan officer (starts at pending)',
  })
  createLoan(
    @Body() dto: CreateLoanDto,
    @UploadedFiles()
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.loansService.createLoan(dto, req.user.userId, files);
  }

  @Roles('LOAN_OFFICER')
  @Post(':id/officer-approve')
  @ApiOperation({
    summary:
      'Approve a pending loan (client-submitted or officer-created) as loan officer',
  })
  approveLoanByOfficer(
    @Param('id') id: string,
    @Body() dto: ReviewLoanDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.loansService.approveLoanByOfficer(id, dto, req.user.userId);
  }

  @Roles('LOAN_OFFICER')
  @Post(':id/officer-reject')
  @ApiOperation({
    summary:
      'Reject a pending loan (client-submitted or officer-created) as loan officer',
  })
  rejectLoanByOfficer(
    @Param('id') id: string,
    @Body() dto: ReviewLoanDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.loansService.rejectLoanByOfficer(id, dto, req.user.userId);
  }

  @Roles('GENERAL_MANAGER')
  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a loan officer-approved loan as GM' })
  approveLoanByGeneralManager(
    @Param('id') id: string,
    @Body() dto: ReviewLoanDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.loansService.approveLoanByGeneralManager(
      id,
      dto,
      req.user.userId,
    );
  }

  @Roles('GENERAL_MANAGER')
  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a loan officer-approved loan as GM' })
  rejectLoanByGeneralManager(
    @Param('id') id: string,
    @Body() dto: ReviewLoanDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.loansService.rejectLoanByGeneralManager(
      id,
      dto,
      req.user.userId,
    );
  }
}
