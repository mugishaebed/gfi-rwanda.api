import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

class BlogContentChunkDto {
  @ApiPropertyOptional({
    example: 'Introduction',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  header?: string;

  @ApiProperty({
    description:
      'Rich HTML content for the chunk body. Inline styles and font declarations are allowed.',
    example:
      '<p style="font-size:16px;font-family:Poppins">Styled paragraph body.</p>',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000000)
  body!: string;

  @ApiPropertyOptional({
    description:
      'Optional base64 data URL image (JPEG/PNG/WEBP), for example data:image/png;base64,....',
    example: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
  })
  @IsOptional()
  @IsString()
  image?: string;
}

export class CreateBlogDto {
  @ApiProperty({
    example: 'How We Disburse Loans Faster in 2026',
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({
    description:
      'Optional blog cover image as base64 data URL (JPEG/PNG/WEBP), for example data:image/png;base64,....',
    example: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
  })
  @IsOptional()
  @IsString()
  thumbnail?: string;

  @ApiProperty({
    type: [BlogContentChunkDto],
    description:
      'Ordered blog chunks. Order is preserved exactly as provided in this array.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BlogContentChunkDto)
  contents!: BlogContentChunkDto[];
}
