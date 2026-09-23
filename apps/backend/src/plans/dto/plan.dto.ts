import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/;

export class CreatePlanDto {
  @ApiProperty({ example: '8 clases mensuales', minLength: 2, maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'Modalidad regular', maxLength: 500 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description?: string;

  @ApiProperty({ type: 'integer', example: 8, minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  classCount!: number;

  @ApiProperty({
    example: '40000.00',
    description: 'Importe decimal como string, con hasta dos decimales',
    pattern: MONEY_PATTERN.source,
  })
  @IsString()
  @Matches(MONEY_PATTERN)
  price!: string;

  @ApiPropertyOptional({ enum: ['ARS'], default: 'ARS' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['ARS'])
  currency?: 'ARS';
}

export class UpdatePlanDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 1000 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(1000)
  classCount?: number;

  @ApiPropertyOptional({
    example: '45000.00',
    pattern: MONEY_PATTERN.source,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(MONEY_PATTERN)
  price?: string;
}

export enum PlanStatusFilter {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ALL = 'all',
}

export class ListPlansQueryDto {
  @ApiPropertyOptional({
    enum: PlanStatusFilter,
    default: PlanStatusFilter.ACTIVE,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsOptional()
  @IsEnum(PlanStatusFilter)
  status: PlanStatusFilter = PlanStatusFilter.ACTIVE;

  @ApiPropertyOptional({ minLength: 1, maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  search?: string;

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

export class PlanResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: 'integer' })
  classCount!: number;

  @ApiProperty({ example: '40000.00', type: String })
  price!: string;

  @ApiProperty({ enum: ['ARS'] })
  currency!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

class PageMetaDto {
  @ApiProperty({ type: 'integer' })
  page!: number;
  @ApiProperty({ type: 'integer' })
  limit!: number;
  @ApiProperty({ type: 'integer' })
  total!: number;
  @ApiProperty({ type: 'integer' })
  totalPages!: number;
}

export class PlanListResponseDto {
  @ApiProperty({ type: [PlanResponseDto] })
  items!: PlanResponseDto[];

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}
