import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

class RepaymentTermItemDto {
  @ApiProperty({ example: '2026-05-01' })
  @IsString()
  @IsNotEmpty()
  dueDate!: string;

  @ApiProperty({ example: 50000 })
  @IsNumber()
  @Min(0)
  amount!: number;
}

export class CreateLoanDto {
  @ApiProperty({
    description: 'Client receiving the loan',
    example: '2b8c4b31-6910-4787-b7da-fd35c1bb3203',
  })
  @IsUUID()
  clientId!: string;

  @ApiProperty({ example: 500000 })
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiProperty({ example: 'Working capital for stock purchase' })
  @IsString()
  @IsNotEmpty()
  purpose!: string;

  @ApiProperty({
    type: [RepaymentTermItemDto],
    description: 'Repayment schedule or terms captured for the loan',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RepaymentTermItemDto)
  repaymentTerms!: RepaymentTermItemDto[];

  @ApiPropertyOptional({
    description: 'Optional guarantor information captured as structured JSON',
    example: {
      fullName: 'Jane Doe',
      nationalId: '1234567890123456',
      phoneNumber: '+250788000000',
    },
  })
  @IsOptional()
  @IsObject()
  guarantorInfo?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Loan officer comments or assessment notes',
    example: 'Client has been active for 2 years and has regular inflows.',
  })
  @IsOptional()
  @IsString()
  comments?: string;
}
