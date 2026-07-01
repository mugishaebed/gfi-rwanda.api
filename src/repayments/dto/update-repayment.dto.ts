import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ParseDate, ParseNumber } from '../../common/dto-transforms';

/**
 * GM-only correction of a repayment. Every field is optional; only the supplied
 * fields are changed. For an APPROVED repayment, amount/split changes reverse the
 * old effect on the loan and reapply the new one in a transaction, so the loan's
 * balances (and every ledger/dashboard total derived from them) stay correct.
 */
export class UpdateRepaymentDto {
  @ApiPropertyOptional({ example: 50000 })
  @IsOptional()
  @ParseNumber()
  @IsNumber()
  @Min(0.01)
  amountPaid?: number;

  @ApiPropertyOptional({
    example: 40000,
    description:
      'Portion of amountPaid applied to principal. principalPaid + interestPaid must equal amountPaid and principalPaid cannot exceed the outstanding principal balance.',
  })
  @IsOptional()
  @ParseNumber()
  @IsNumber()
  @Min(0)
  principalPaid?: number;

  @ApiPropertyOptional({
    example: 10000,
    description: 'Portion of amountPaid applied to interest.',
  })
  @IsOptional()
  @ParseNumber()
  @IsNumber()
  @Min(0)
  interestPaid?: number;

  @ApiPropertyOptional({
    description: 'Corrected repayment date',
    example: '2026-04-20T10:00:00.000Z',
  })
  @IsOptional()
  @ParseDate()
  @Type(() => Date)
  @IsDate()
  paymentDate?: Date;

  @ApiPropertyOptional({
    description: 'Optional note explaining the correction (appended to history)',
    example: 'Corrected amount to match bank statement.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  note?: string;
}
