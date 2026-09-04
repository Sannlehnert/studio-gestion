import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SessionRole } from '@prisma/client';

export class EmptyBodyDto {}

export class AdminIdentityDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'email' }) email!: string;
}
export class StudentIdentityDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() fullName!: string;
}
export class UserIdentityDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: SessionRole }) role!: SessionRole;
  @ApiPropertyOptional({ format: 'email' }) email?: string;
  @ApiPropertyOptional() fullName?: string;
}
export class AdminLoginResponseDto {
  @ApiProperty({ type: AdminIdentityDto }) admin!: AdminIdentityDto;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: Date;
}
export class StudentActivationResponseDto {
  @ApiProperty({ type: StudentIdentityDto }) student!: StudentIdentityDto;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: Date;
}
export class MeResponseDto {
  @ApiProperty({ type: UserIdentityDto }) user!: UserIdentityDto;
}
export class RoleCheckResponseDto extends MeResponseDto {
  @ApiProperty() message!: string;
}
export class AccessResponseDto {
  @ApiProperty({ format: 'uuid' }) accessId!: string;
  @ApiProperty({
    description:
      'Secreto de un solo uso en fragmento #token=. No almacenar ni registrar.',
  })
  activationUrl!: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: Date;
}
