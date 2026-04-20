import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ReviewLoanDto {
  @ApiPropertyOptional({
    description: 'Optional review note from the general manager',
    example: 'Approved after reviewing cash flow and repayment ability.',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
