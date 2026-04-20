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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { LoanStatus } from '../generated/prisma/enums';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { ReviewLoanDto } from './dto/review-loan.dto';

type AuthenticatedRequest = {
  user: {
    userId: string;
    email: string;
    role: string;
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

  @Roles('LOAN_OFFICER', 'GENERAL_MANAGER')
  @Get(':id')
  @ApiOperation({ summary: 'Retrieve a single loan with review history' })
  findOne(@Param('id') id: string) {
    return this.loansService.findOne(id);
  }

  @Roles('LOAN_OFFICER')
  @Post()
  @ApiOperation({
    summary: 'Create a loan request as a loan officer with pending status',
  })
  createLoan(@Body() dto: CreateLoanDto, @Req() req: AuthenticatedRequest) {
    return this.loansService.createLoan(dto, req.user.userId);
  }

  @Roles('GENERAL_MANAGER')
  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a pending loan as general manager' })
  approveLoan(
    @Param('id') id: string,
    @Body() dto: ReviewLoanDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.loansService.approveLoan(id, dto, req.user.userId);
  }

  @Roles('GENERAL_MANAGER')
  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a pending loan as general manager' })
  rejectLoan(
    @Param('id') id: string,
    @Body() dto: ReviewLoanDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.loansService.rejectLoan(id, dto, req.user.userId);
  }
}
