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
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RepaymentStatus } from '../generated/prisma/enums';
import { CreateOnlineRepaymentDto } from './dto/create-online-repayment.dto';
import { RepaymentsService } from './repayments.service';

type AuthenticatedRequest = {
  user: {
    userId: string;
  };
};

@ApiTags('Clients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('clients')
export class ClientRepaymentsController {
  constructor(private readonly repaymentsService: RepaymentsService) {}

  @Roles('CLIENT')
  @Get('me/repayments')
  @ApiOperation({
    summary: 'Retrieve current client repayments with pagination',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    example: 1,
    description: 'Page number to retrieve.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: 'Maximum number of records per page.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: RepaymentStatus,
    description: 'Optional repayment status filter.',
  })
  findMyRepayments(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status', new ParseEnumPipe(RepaymentStatus, { optional: true }))
    status: RepaymentStatus | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.repaymentsService.findMyRepayments(
      req.user.userId,
      page,
      limit,
      status,
    );
  }

  @Roles('CLIENT')
  @Get('me/repayments/:id')
  @ApiOperation({ summary: 'Retrieve a single current client repayment' })
  findMyRepayment(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.repaymentsService.findMyRepayment(req.user.userId, id);
  }

  @Roles('CLIENT')
  @Post('me/loans/:loanId/payments')
  @ApiOperation({
    summary: 'Pay an active or overdue client loan online',
  })
  createOnlineRepayment(
    @Param('loanId') loanId: string,
    @Body() dto: CreateOnlineRepaymentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.repaymentsService.createOnlineRepayment(
      loanId,
      dto,
      req.user.userId,
    );
  }
}
