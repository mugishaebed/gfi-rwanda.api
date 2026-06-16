import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DashboardService, GmSummaryPeriod } from './dashboard.service';

type AuthenticatedRequest = {
  user: {
    userId: string;
    email: string;
    roles: string[];
  };
};

const GM_PERIODS: GmSummaryPeriod[] = ['month', 'quarter', 'ytd'];

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Roles('GENERAL_MANAGER')
  @Get('gm-summary')
  @ApiOperation({ summary: 'Institution-wide overview for the General Manager' })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: GM_PERIODS,
    description: 'Comparison window for KPIs/deltas. Defaults to month.',
  })
  getGmSummary(@Query('period') period?: string) {
    const safePeriod: GmSummaryPeriod = GM_PERIODS.includes(
      period as GmSummaryPeriod,
    )
      ? (period as GmSummaryPeriod)
      : 'month';
    return this.dashboardService.getGmSummary(safePeriod);
  }

  @Roles('LOAN_OFFICER')
  @Get('officer-summary')
  @ApiOperation({
    summary: 'Worklist overview scoped to the authenticated loan officer',
  })
  getOfficerSummary(@Req() req: AuthenticatedRequest) {
    return this.dashboardService.getOfficerSummary(req.user.userId);
  }
}
