import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateBlogDto {
  @ApiProperty({
    example: 'How We Disburse Loans Faster in 2026',
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({
    description:
      'Rich HTML content. Inline styles and font declarations are allowed.',
    example:
      '<h2 style="font-family:Poppins">Welcome</h2><p style="font-size:16px">Styled paragraph.</p>',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000000)
  content!: string;
}
