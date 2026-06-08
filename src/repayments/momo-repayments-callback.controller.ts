import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RepaymentsService } from './repayments.service';

interface MomoCallbackBody {
  referenceId?: string;
  externalId?: string;
  status?: string;
  financialTransactionId?: string;
  reason?: unknown;
}

@ApiTags('Webhooks')
@Controller({ path: 'repayments/momo', version: VERSION_NEUTRAL })
export class MomoRepaymentsCallbackController {
  private readonly logger = new Logger(MomoRepaymentsCallbackController.name);

  constructor(private readonly repaymentsService: RepaymentsService) {}

  @Post('callback')
  @HttpCode(200)
  @ApiOperation({
    summary: 'MTN MoMo collections webhook — called by MTN, no auth required',
  })
  async handleCallback(@Body() body: MomoCallbackBody) {
    const repaymentId = body.externalId;
    const status = body.status;

    if (!repaymentId || !status) {
      this.logger.warn('MoMo collection callback missing fields', body);
      return { received: true };
    }

    await this.repaymentsService.handleMomoCollectionCallback(
      repaymentId,
      status,
    );

    return { received: true };
  }
}
