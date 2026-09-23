import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateScheduleDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 7,
    description: 'Día ISO: lunes=1, domingo=7',
  })
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @ApiProperty({ example: '19:00', pattern: LOCAL_TIME_PATTERN.source })
  @IsString()
  @Matches(LOCAL_TIME_PATTERN)
  startTime!: string;

  @ApiProperty({ example: '21:00', pattern: LOCAL_TIME_PATTERN.source })
  @IsString()
  @Matches(LOCAL_TIME_PATTERN)
  endTime!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 1000, example: 20 })
  @IsInt()
  @Min(1)
  @Max(1000)
  defaultCapacity!: number;
}

export class UpdateScheduleDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 7 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number;

  @ApiPropertyOptional({ example: '18:30', pattern: LOCAL_TIME_PATTERN.source })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(LOCAL_TIME_PATTERN)
  startTime?: string;

  @ApiPropertyOptional({ example: '20:30', pattern: LOCAL_TIME_PATTERN.source })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(LOCAL_TIME_PATTERN)
  endTime?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 1000 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(1000)
  defaultCapacity?: number;
}

export enum ScheduleStatusFilter {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ALL = 'all',
}

export class ListSchedulesQueryDto {
  @ApiPropertyOptional({
    enum: ScheduleStatusFilter,
    default: ScheduleStatusFilter.ACTIVE,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsOptional()
  @IsEnum(ScheduleStatusFilter)
  status: ScheduleStatusFilter = ScheduleStatusFilter.ACTIVE;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 7 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number;

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

export class ScheduleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 7 })
  dayOfWeek!: number;
  @ApiProperty({ example: '19:00' })
  startTime!: string;
  @ApiProperty({ example: '21:00' })
  endTime!: string;
  @ApiProperty({ type: 'integer' })
  defaultCapacity!: number;
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

export class ScheduleListResponseDto {
  @ApiProperty({ type: [ScheduleResponseDto] })
  items!: ScheduleResponseDto[];
  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}
