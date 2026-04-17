import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RepaymentsService } from './repayments.service';

@ApiTags('Repayments')
@Controller('repayments')
export class RepaymentsController {
  constructor(private readonly repaymentsService: RepaymentsService) {}
}
