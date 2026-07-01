import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
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
import { LoansService } from './loans.service';

type AuthenticatedRequest = {
  user: {
    userId: string;
    email: string;
    roles: string[];
  };
};

@ApiTags('Clients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('clients')
export class ClientLoansController {
  constructor(private readonly loansService: LoansService) {}

  @Roles('CLIENT')
  @Get('me/loan-offer')
  @ApiOperation({ summary: 'Retrieve the current client loan offer for the dashboard' })
  getLoanOffer(@Req() req: AuthenticatedRequest) {
    return this.loansService.getClientLoanOffer(req.user.userId);
  }

  @Roles('CLIENT')
  @Get('me/loans')
  @ApiOperation({ summary: 'Retrieve current client loans with pagination' })
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
    example: 'active',
    description:
      'Optional client-facing loan status filter: pending, active, completed, overdue, rejected, cancelled.',
  })
  getMyLoans(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.loansService.findMyLoansForClient(
      req.user.userId,
      page,
      limit,
      status,
    );
  }

  @Roles('CLIENT')
  @Get('me/loans/:id')
  @ApiOperation({ summary: 'Retrieve a single client loan by id' })
  getMyLoanById(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.loansService.findMyLoanDetailForClient(req.user.userId, id);
  }

  @Roles('CLIENT')
  @Get('me/loan-dashboard')
  @ApiOperation({ summary: 'Retrieve loan dashboard summary for the current client' })
  getLoanDashboard(@Req() req: AuthenticatedRequest) {
    return this.loansService.getClientLoanDashboard(req.user.userId);
  }
}
