import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow,
  IsDate,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import {
  ParseDate,
  ParseNumber,
  ParseStringArray,
} from '../../common/dto-transforms';

export class CreateRepaymentDto {
  @ApiProperty({
    description: 'Loan receiving the repayment',
    example: '2b8c4b31-6910-4787-b7da-fd35c1bb3203',
  })
  @IsUUID()
  loanId!: string;

  @ApiProperty({ example: 50000 })
  @ParseNumber()
  @IsNumber()
  @Min(0.01)
  amountPaid!: number;

  @ApiProperty({
    description: 'Date the client made the repayment',
    example: '2026-04-20T10:00:00.000Z',
  })
  @ParseDate()
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

  @ApiPropertyOptional({
    type: [String],
    description: 'Optional labels matching the uploaded repayment proof documents.',
    example: ['Mobile Money Receipt'],
  })
  @IsOptional()
  @ParseStringArray()
  @IsArray()
  @IsString({ each: true })
  documentLabels?: string[];

  @ApiPropertyOptional({
    type: 'array',
    items: {
      type: 'string',
      format: 'binary',
    },
    description:
      'Supporting document files. Pass each file under the field name "documents".',
  })
  @IsOptional()
  @Allow()
  documents?: any[];
}
