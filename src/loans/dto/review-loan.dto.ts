import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDate, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ParseDate, ParseNumber } from '../../common/dto-transforms';

export class ReviewLoanDto {
  @ApiPropertyOptional({
    description: 'Optional review note from the general manager',
    example: 'Approved after reviewing cash flow and repayment ability.',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    example: 490000,
    description:
      'Manual loans only: actual net amount disbursed to the client after fee deductions, decided by the GM at approval. Defaults to the approved loan amount if not provided.',
  })
  @IsOptional()
  @ParseNumber()
  @IsNumber()
  @Min(0.01)
  disbursedAmount?: number;

  @ApiPropertyOptional({
    example: '2026-06-01',
    description:
      'Manual loans only: date the funds were handed to or transferred to the client. Defaults to the approval date if not provided.',
  })
  @IsOptional()
  @ParseDate()
  @IsDate()
  disbursedAt?: Date;
}
