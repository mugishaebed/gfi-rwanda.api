import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow,
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { LoanSector } from '../../generated/prisma/enums';
import {
  ParseDate,
  ParseJson,
  ParseJsonObjectOf,
  ParseNumber,
  ParseStringArray,
} from '../../common/dto-transforms';

class RepaymentScheduleItemDto {
  @ApiProperty({
    example: 1,
    description: 'Installment sequence number starting at 1.',
  })
  @IsInt()
  @Min(1)
  installmentNo!: number;

  @ApiProperty({
    example: '2026-06-05',
    description: 'Installment due date in ISO date format (YYYY-MM-DD).',
  })
  @IsString()
  @IsNotEmpty()
  dueDate!: string;

  @ApiProperty({
    example: 100000,
    description: 'Installment amount due on the given due date.',
  })
  @ParseNumber()
  @IsNumber()
  @Min(0.01)
  amount!: number;
}

class RepaymentTermsDto {
  @ApiProperty({
    example: 'RWF',
    description: 'Repayment currency.',
  })
  @IsString()
  @IsNotEmpty()
  currency!: string;

  @ApiProperty({
    example: 6,
    description: 'Total number of installments.',
  })
  @ParseNumber()
  @IsInt()
  @Min(1)
  installmentsCount!: number;

  @ApiProperty({
    example: 100000,
    description: 'Expected amount per installment.',
  })
  @ParseNumber()
  @IsNumber()
  @Min(0.01)
  amountPerInstallment!: number;

  @ApiProperty({
    example: 6,
    description: 'Repayment duration in months.',
  })
  @ParseNumber()
  @IsInt()
  @Min(1)
  periodMonths!: number;

  @ApiProperty({
    example: 5,
    description: 'Recurring day of month for repayment (1 to 31).',
  })
  @ParseNumber()
  @IsInt()
  @Min(1)
  @Max(31)
  paymentDayOfMonth!: number;

  @ApiProperty({
    type: [RepaymentScheduleItemDto],
    description: 'Detailed installment schedule.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RepaymentScheduleItemDto)
  schedule!: RepaymentScheduleItemDto[];
}

export class CreateLoanDto {
  @ApiProperty({
    description: 'Client receiving the loan',
    example: '2b8c4b31-6910-4787-b7da-fd35c1bb3203',
  })
  @IsUUID()
  clientId!: string;

  @ApiProperty({ example: 500000 })
  @ParseNumber()
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiProperty({ example: 'Working capital for stock purchase' })
  @IsString()
  @IsNotEmpty()
  purpose!: string;

  @ApiProperty({
    enum: LoanSector,
    example: LoanSector.GENERAL_TRADE,
    description: 'Economic sector the loan belongs to, used for insights.',
  })
  @IsEnum(LoanSector)
  sector!: LoanSector;

  @ApiProperty({
    example: 2.5,
    description: 'Interest rate percentage charged per month.',
  })
  @ParseNumber()
  @IsNumber()
  @Min(0)
  interestRatePercentPerMonth!: number;

  @ApiProperty({
    example: 12,
    description: 'Loan term in months.',
  })
  @ParseNumber()
  @IsInt()
  @Min(1)
  termInMonths!: number;

  @ApiProperty({
    example: '2026-06-01',
    description: 'Loan term start date.',
  })
  @ParseDate()
  @IsDate()
  termStartDate!: Date;

  @ApiProperty({
    example: '2026-12-01',
    description: 'Loan term end date.',
  })
  @ParseDate()
  @IsDate()
  termEndDate!: Date;

  @ApiProperty({
    example: 3,
    description:
      'Maximum number of days after completing documents to disburse the loan.',
  })
  @ParseNumber()
  @IsInt()
  @Min(0)
  disbursementWithinDays!: number;

  @ApiProperty({
    example: 'Vehicle',
    description: 'Collateral type.',
  })
  @IsString()
  @IsNotEmpty()
  collateralType!: string;

  @ApiProperty({
    example: 4500000,
    description: 'Estimated collateral value.',
  })
  @ParseNumber()
  @IsNumber()
  @Min(0.01)
  collateralEstimatedValue!: number;

  @ApiProperty({
    example: 'Kigali - Gasabo',
    description: 'Collateral location.',
  })
  @IsString()
  @IsNotEmpty()
  collateralLocation!: string;

  @ApiProperty({
    example: 12,
    description: 'Number of repayment installments.',
  })
  @ParseNumber()
  @IsInt()
  @Min(1)
  repaymentInstallmentsCount!: number;

  @ApiProperty({
    example: 100000,
    description: 'Monthly repayment amount.',
  })
  @ParseNumber()
  @IsNumber()
  @Min(0.01)
  repaymentAmountPerMonth!: number;

  @ApiProperty({
    example: 12,
    description: 'Repayment period in months.',
  })
  @ParseNumber()
  @IsInt()
  @Min(1)
  repaymentPeriodMonths!: number;

  @ApiProperty({
    example: 5,
    description: 'Recurring day number of each month for repayment (1 to 31).',
  })
  @ParseNumber()
  @IsInt()
  @Min(1)
  @Max(31)
  paymentDayOfMonth!: number;

  @ApiProperty({
    example: 2.0,
    description: 'Loan processing fee percentage.',
  })
  @ParseNumber()
  @IsNumber()
  @Min(0)
  loanProcessingFeePercent!: number;

  @ApiProperty({
    example: 1.0,
    description: 'Administrative fee percentage.',
  })
  @ParseNumber()
  @IsNumber()
  @Min(0)
  administrativeFeePercent!: number;

  @ApiProperty({
    example: 0.5,
    description: 'Loan application fee percentage.',
  })
  @ParseNumber()
  @IsNumber()
  @Min(0)
  loanApplicationFeePercent!: number;

  @ApiProperty({
    example: 1.5,
    description: 'Early repayment fee percentage.',
  })
  @ParseNumber()
  @IsNumber()
  @Min(0)
  earlyRepaymentFeePercent!: number;

  @ApiProperty({
    example: 0.2,
    description: 'Default penalty fee percentage per day.',
  })
  @ParseNumber()
  @IsNumber()
  @Min(0)
  defaultPenaltyFeePercentPerDay!: number;

  @ApiProperty({
    example: 'Jane Doe',
    description: 'Spouse full name from spouse consent section.',
  })
  @IsString()
  @IsOptional()
  spouseName?: string;

  @ApiProperty({
    type: RepaymentTermsDto,
    description: 'Repayment schedule or terms captured for the loan',
  })
  @ParseJsonObjectOf(RepaymentTermsDto)
  @IsObject()
  @ValidateNested()
  @Type(() => RepaymentTermsDto)
  repaymentTerms!: RepaymentTermsDto;

  @ApiPropertyOptional({
    description: 'Optional guarantor information captured as structured JSON',
    example: {
      fullName: 'Jane Doe',
      nationalId: '1234567890123456',
      phoneNumber: '+250788000000',
    },
  })
  @IsOptional()
  @ParseJson()
  @IsObject()
  guarantorInfo?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Loan officer comments or assessment notes',
    example: 'Client has been active for 2 years and has regular inflows.',
  })
  @IsOptional()
  @IsString()
  comments?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Optional labels matching the uploaded loan documents.',
    example: ['Loan Application Form', 'Collateral Photo'],
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
