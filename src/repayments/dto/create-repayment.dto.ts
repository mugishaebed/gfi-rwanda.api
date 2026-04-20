import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateRepaymentDto {
  @ApiProperty({
    description: 'Loan receiving the repayment',
    example: '2b8c4b31-6910-4787-b7da-fd35c1bb3203',
  })
  @IsUUID()
  loanId!: string;

  @ApiProperty({ example: 50000 })
  @IsNumber()
  @Min(0.01)
  amountPaid!: number;

  @ApiProperty({
    description: 'Date the client made the repayment',
    example: '2026-04-20T10:00:00.000Z',
  })
  @Type(() => Date)
  @IsDate()
  paymentDate!: Date;

  @ApiPropertyOptional({
    description: 'Optional notes entered by the loan officer',
    example: 'Cash payment received at branch.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  notes?: string;
}
