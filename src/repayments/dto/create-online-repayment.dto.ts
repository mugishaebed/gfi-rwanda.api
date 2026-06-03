import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ParseNumber } from '../../common/dto-transforms';
import { OnlinePaymentProvider } from '../../generated/prisma/enums';

export class CreateOnlineRepaymentDto {
  @ApiProperty({ example: 50000 })
  @ParseNumber()
  @IsNumber()
  @Min(0.01)
  amountPaid!: number;

  @ApiProperty({
    enum: OnlinePaymentProvider,
    example: OnlinePaymentProvider.MOBILE_MONEY,
  })
  @IsEnum(OnlinePaymentProvider)
  paymentProvider!: OnlinePaymentProvider;

  @ApiPropertyOptional({
    description:
      'Client payment phone number, if it differs from the phone on their client profile.',
    example: '0788123456',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  paymentPhoneNumber?: string;

  @ApiPropertyOptional({
    description:
      'Optional external receipt/reference if the frontend already has one from a payment provider.',
    example: 'MOMO-20260514-0001',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  paymentReference?: string;

  @ApiPropertyOptional({
    description: 'Optional client note attached to the online repayment.',
    example: 'Paid with Mobile Money from my registered phone number.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  notes?: string;
}
