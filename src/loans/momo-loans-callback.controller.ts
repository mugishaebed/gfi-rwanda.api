import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LoansService } from './loans.service';

interface MomoDisbursementCallbackBody {
  referenceId?: string;
  externalId?: string;
  status?: string;
  financialTransactionId?: string;
  reason?: unknown;
}

@ApiTags('Webhooks')
@Controller({ path: 'loans/momo', version: VERSION_NEUTRAL })
export class MomoLoansCallbackController {
  private readonly logger = new Logger(MomoLoansCallbackController.name);

  constructor(private readonly loansService: LoansService) {}

  @Post('callback')
  @HttpCode(200)
  @ApiOperation({
    summary: 'MTN MoMo disbursement webhook — called by MTN, no auth required',
  })
  async handleCallback(@Body() body: MomoDisbursementCallbackBody) {
    const referenceId = body.referenceId ?? body.externalId;
    const status = body.status;

    if (!referenceId || !status) {
      this.logger.warn('MoMo disbursement callback missing fields', body);
      return { received: true };
    }

    await this.loansService.handleMomoDisbursementCallback(referenceId, status);

    return { received: true };
  }
}
