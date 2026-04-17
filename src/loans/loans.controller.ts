import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LoansService } from './loans.service';

@ApiTags('Loans')
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) {}
}
