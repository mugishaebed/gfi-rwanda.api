import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class OverrideOnlineRepaymentDto {
  @ApiProperty({
    enum: ['approve', 'reject'],
    description: 'Whether to manually approve or reject the stuck online repayment.',
  })
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';
}
