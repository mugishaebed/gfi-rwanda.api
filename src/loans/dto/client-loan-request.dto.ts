import { ApiProperty } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { DisbursementMethod } from '../../generated/prisma/enums';
import { ParseBoolean, ParseNumber } from '../../common/dto-transforms';

export const CLIENT_LOAN_CURRENCY = 'RWF';
export const CLIENT_LOAN_TERM_IN_MONTHS = 1;
export const CLIENT_LOAN_TERMS_VERSION = 'loan-request-v1';

export class ClientLoanRequestDto {
  @ApiProperty({ example: 150000, minimum: 100, maximum: 500000 })
  @ParseNumber()
  @IsNumber()
  @Min(100)
  @Max(500000)
  amount!: number;

  @ApiProperty({ example: CLIENT_LOAN_CURRENCY })
  @IsString()
  @Equals(CLIENT_LOAN_CURRENCY)
  currency!: typeof CLIENT_LOAN_CURRENCY;

  @ApiProperty({ example: CLIENT_LOAN_TERM_IN_MONTHS })
  @ParseNumber()
  @IsNumber()
  @Equals(CLIENT_LOAN_TERM_IN_MONTHS)
  termInMonths!: typeof CLIENT_LOAN_TERM_IN_MONTHS;

  @ApiProperty({ example: true })
  @ParseBoolean()
  @IsBoolean()
  @Equals(true)
  termsAccepted!: true;

  @ApiProperty({ example: CLIENT_LOAN_TERMS_VERSION })
  @IsString()
  @Equals(CLIENT_LOAN_TERMS_VERSION)
  termsVersion!: typeof CLIENT_LOAN_TERMS_VERSION;

  @ApiProperty({
    enum: DisbursementMethod,
    example: DisbursementMethod.MOBILE_MONEY,
  })
  @IsEnum(DisbursementMethod)
  disbursementMethod!: DisbursementMethod;
}
