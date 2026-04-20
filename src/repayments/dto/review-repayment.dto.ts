import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ReviewRepaymentDto {
  @ApiPropertyOptional({
    description: 'Optional review note from the general manager',
    example: 'Approved after matching cash receipt.',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
