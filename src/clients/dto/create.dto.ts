import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessType, ClientType } from '../../generated/prisma/enums';
import {
  ParseBoolean,
  ParseDate,
  ParseJson,
  ParseNumber,
  ParseStringArray,
} from '../../common/dto-transforms';

export class BusinessShareholderDto {
  @ApiProperty({
    example: 'Jane Doe',
    description: 'Name of the shareholder.',
  })
  @IsString()
  name!: string;

  @ApiProperty({
    example: 40,
    description: 'Ownership percentage held by the shareholder.',
  })
  @ParseNumber()
  @IsNumber()
  ownershipPercentage!: number;
}

export class CreateIndividualClientDto {
  @ApiProperty({
    enum: ClientType,
    example: ClientType.INDIVIDUAL,
    description: 'Client category. Must be INDIVIDUAL for this endpoint.',
  })
  @IsEnum(ClientType)
  type!: ClientType;

  @ApiProperty({
    example: 'jean@example.com',
    description: 'Client email address.',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: '+250788123456',
    description: 'Client phone number in international format.',
  })
  @IsPhoneNumber()
  phone!: string;

  @ApiProperty({
    example: 'Kigali, Rwanda',
    description: 'Residential address of the client.',
  })
  @IsString()
  address!: string;

  @ApiProperty({
    example: '1234567890',
    description: 'Bank account number linked to the client.',
  })
  @IsString()
  accountNumber!: string;

  @ApiProperty({
    example: 'Jean Claude',
    description: 'Full legal name of the client.',
  })
  @IsString()
  fullName!: string;

  @ApiProperty({
    example: '1199980012345678',
    description: 'National identification number.',
  })
  @IsString()
  nationalId!: string;

  @ApiProperty({
    example: 'Male',
    description: 'Gender of the client.',
  })
  @IsString()
  gender!: string;

  @ApiProperty({
    example: '1995-05-20T00:00:00.000Z',
    description: 'Date of birth of the client.',
  })
  @ParseDate()
  @Type(() => Date)
  @IsDate()
  dateOfBirth!: Date;

  @ApiPropertyOptional({
    example: 'Rwandan',
    description: 'Nationality of the client.',
  })
  @IsOptional()
  @IsString()
  nationality?: string;

  @ApiPropertyOptional({
    example: 'Single',
    description: 'Marital status of the client.',
  })
  @IsOptional()
  @IsString()
  maritalStatus?: string;

  @ApiPropertyOptional({
    example: 'Acme Ltd',
    description: 'Employer name of the client.',
  })
  @IsOptional()
  @IsString()
  employerName?: string;

  @ApiPropertyOptional({
    example: 'Software Engineer',
    description: 'Occupation of the client.',
  })
  @IsOptional()
  @IsString()
  occupation?: string;

  @ApiPropertyOptional({
    example: '1500000 RWF',
    description: 'Monthly income of the client.',
  })
  @IsOptional()
  @IsString()
  monthlyIncome?: string;

  @ApiPropertyOptional({
    example: 'Bank of Kigali',
    description: 'Bank name used by the client.',
  })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({
    example: '001234567890',
    description: 'Bank account number used by the client.',
  })
  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether the client is a politically exposed person.',
  })
  @IsOptional()
  @ParseBoolean()
  @IsBoolean()
  pep?: boolean;

  @ApiPropertyOptional({
    example: 'Alice Mukamana',
    description: 'Reference person for the client.',
  })
  @IsOptional()
  @IsString()
  referenceName?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Optional labels matching the uploaded client documents.',
    example: ['National ID', 'Payslip'],
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
  documents?: any[];
}

export class CreateBusinessClientDto {
  @ApiProperty({
    enum: ClientType,
    example: ClientType.BUSINESS,
    description: 'Client category. Must be BUSINESS for this endpoint.',
  })
  @IsEnum(ClientType)
  type!: ClientType;

  @ApiProperty({
    example: 'company@example.com',
    description: 'Business email address.',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: '+250788123456',
    description: 'Business phone number in international format.',
  })
  @IsPhoneNumber()
  phone!: string;

  @ApiProperty({
    example: 'Kigali Special Economic Zone',
    description: 'Business address.',
  })
  @IsString()
  address!: string;

  @ApiProperty({
    example: '9876543210',
    description: 'Bank account number linked to the business.',
  })
  @IsString()
  accountNumber!: string;

  @ApiProperty({
    example: 'GFI Rwanda Ltd',
    description: 'Registered business name.',
  })
  @IsString()
  businessName!: string;

  @ApiPropertyOptional({
    example: 'https://gfi-rwanda.com',
    description: 'Public website of the business.',
  })
  @IsOptional()
  @IsUrl()
  businessWebsite?: string;

  @ApiProperty({
    example: false,
    description: 'Whether the business is politically exposed.',
  })
  @ParseBoolean()
  @IsBoolean()
  pep!: boolean;

  @ApiProperty({
    example: 'REG-2024-001',
    description: 'Official registration number of the business.',
  })
  @IsString()
  registrationNumber!: string;

  @ApiProperty({
    enum: BusinessType,
    example: BusinessType.LLC,
    description: 'Registered business structure.',
  })
  @IsEnum(BusinessType)
  businessType!: BusinessType;

  @ApiProperty({
    example: '2020-01-10T00:00:00.000Z',
    description: 'Date the business was incorporated.',
  })
  @ParseDate()
  @Type(() => Date)
  @IsDate()
  incorporationDate!: Date;

  @ApiProperty({
    type: [BusinessShareholderDto],
    description: 'List of business shareholders and their ownership split.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @ParseJson()
  @Type(() => BusinessShareholderDto)
  businessShareholders!: BusinessShareholderDto[];

  @ApiPropertyOptional({
    example: 'Bank of Kigali',
    description: 'Bank used by the business.',
  })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({
    example: '009876543210',
    description: 'Business bank account number.',
  })
  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @ApiPropertyOptional({
    example: 'John Doe',
    description: 'Authorized signatory for the business.',
  })
  @IsOptional()
  @IsString()
  authorizedSignatory?: string;

  @ApiPropertyOptional({
    example: 'Managing Director',
    description: 'Designation of the authorized signatory.',
  })
  @IsOptional()
  @IsString()
  authorizedSignatoryDesignation?: string;

  @ApiPropertyOptional({
    example: '200000000 RWF',
    description: 'Estimated annual revenue.',
  })
  @IsOptional()
  @IsString()
  annualRevenue?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Optional labels matching the uploaded business client documents.',
    example: ['Certificate of Incorporation', 'Tax Clearance'],
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
  documents?: any[];
}
