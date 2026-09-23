import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
} from 'class-validator';
import { AuditActorType } from '@prisma/client';
export class PageQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    default: 1,
    minimum: 1,
    maximum: 100000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;
  @ApiPropertyOptional({
    type: 'integer',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
export class AuditQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: AuditActorType })
  @IsOptional()
  @IsEnum(AuditActorType)
  actorType?: AuditActorType;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorId?: string;
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  entityType?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  entityId?: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  action?: string;
  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Inclusivo, con zona horaria',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  dateFrom?: string;
  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Exclusivo, con zona horaria',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  dateTo?: string;
}
export class PageMetaDto {
  @ApiProperty({ type: 'integer' }) page!: number;
  @ApiProperty({ type: 'integer' }) limit!: number;
  @ApiProperty({ type: 'integer' }) total!: number;
  @ApiProperty({ type: 'integer' }) totalPages!: number;
}
export class AuditLogResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: AuditActorType }) actorType!: AuditActorType;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) actorId!:
    string | null;
  @ApiProperty() action!: string;
  @ApiProperty({ type: String, nullable: true }) entityType!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) entityId!:
    string | null;
  @ApiProperty({
    type: Object,
    description:
      'Campos públicos permitidos por acción; eventos desconocidos devuelven objeto vacío',
  })
  metadata!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}
export class AuditListResponseDto {
  @ApiProperty({ type: [AuditLogResponseDto] }) items!: AuditLogResponseDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
