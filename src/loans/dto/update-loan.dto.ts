import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateLoanDto } from './create-loan.dto';

/**
 * GM-only loan correction. Every loan field is optional (only supplied fields are
 * changed); client, documents and upload labels are not editable through this
 * path. Derived figures (totalInterestExpected, outstandingBalance) are recomputed
 * by the service, so ledger and dashboard totals update automatically.
 */
export class UpdateLoanDto extends PartialType(
  OmitType(CreateLoanDto, ['clientId', 'documents', 'documentLabels'] as const),
) {
  @ApiPropertyOptional({
    description: 'Optional note explaining the edit (recorded in the audit log)',
    example: 'Corrected principal to match signed contract.',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
