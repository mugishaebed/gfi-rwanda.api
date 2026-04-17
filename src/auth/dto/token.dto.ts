import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token previously issued during login or refresh.',
    example:
      '3c0b3d37-66b6-4a23-9a3e-f5f11b81c3d8.9d8f4d98bf4bc6a2fb08f608d1d0bd1d4a4db795bfb912d9c164bb9d69f64dd0',
  })
  @IsString()
  refreshToken!: string;
}

export class LogoutDto {
  @ApiProperty({
    description: 'User id whose refresh token should be revoked.',
    example: '3c0b3d37-66b6-4a23-9a3e-f5f11b81c3d8',
  })
  @IsString()
  userId!: string;
}
