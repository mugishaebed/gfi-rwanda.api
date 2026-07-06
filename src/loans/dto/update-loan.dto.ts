import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDate, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ParseDate, ParseNumber } from '../../common/dto-transforms';

/**
 * GM-only correction of the disbursement details the GM recorded at approval.
 * The loan application fields (amount, terms, collateral, fees, schedule) belong
 * to the client/officer and are intentionally NOT editable here — only the
 * disbursed amount and disbursement date the GM entered can be corrected.
 */
export class UpdateLoanDto {
  @ApiPropertyOptional({
    example: 490000,
    description: 'Corrected net amount actually disbursed to the client.',
  })
  @IsOptional()
  @ParseNumber()
  @IsNumber()
  @Min(0.01)
  disbursedAmount?: number;

  @ApiPropertyOptional({
    example: '2026-06-01',
    description: 'Corrected date the funds were disbursed to the client.',
  })
  @IsOptional()
  @ParseDate()
  @IsDate()
  disbursedAt?: Date;

  @ApiPropertyOptional({
    description:
      'Optional note explaining the correction (recorded in the audit log).',
    example: 'Corrected disbursed amount after bank confirmation.',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
