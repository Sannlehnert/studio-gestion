import { ParticipationOrigin } from '../class-participation.service';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClassSessionStatus } from '@prisma/client';

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ZONED_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export class GenerateClassSessionsDto {
  @ApiProperty({ format: 'date', example: '2026-09-01' })
  @IsString()
  @Matches(LOCAL_DATE_PATTERN)
  dateFrom!: string;

  @ApiProperty({ format: 'date', example: '2026-09-30' })
  @IsString()
  @Matches(LOCAL_DATE_PATTERN)
  dateTo!: string;
}

export enum ClassSessionStatusFilter {
  SCHEDULED = 'scheduled',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
  ALL = 'all',
}

export class ListClassSessionsQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    description:
      'true: fecha actual del negocio según BusinessTime. No combinar con dateFrom/dateTo.',
  })
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsOptional()
  @IsBoolean()
  today?: boolean;
  @ApiPropertyOptional({ enum: ClassSessionStatusFilter, default: 'all' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsOptional()
  @IsEnum(ClassSessionStatusFilter)
  status: ClassSessionStatusFilter = ClassSessionStatusFilter.ALL;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  scheduleId?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsString()
  @Matches(LOCAL_DATE_PATTERN)
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsString()
  @Matches(LOCAL_DATE_PATTERN)
  dateTo?: string;

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

export class UpdateClassSessionCapacityDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity!: number;
}

export class UpdateClassSessionTimeDto {
  @ApiProperty({ format: 'date-time', example: '2026-09-08T20:00:00-03:00' })
  @IsString()
  @IsISO8601({ strict: true })
  @Matches(ZONED_DATE_TIME_PATTERN)
  startAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-08T22:00:00-03:00' })
  @IsString()
  @IsISO8601({ strict: true })
  @Matches(ZONED_DATE_TIME_PATTERN)
  endAt!: string;
}

export class CancelClassSessionDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

class ClassSessionScheduleDto {
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
}

export class ClassSessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  scheduleId!: string;
  @ApiProperty({
    format: 'date',
    description: 'Identidad local de la recurrencia',
  })
  occurrenceDate!: string;
  @ApiProperty({ format: 'date-time' })
  startAt!: Date;
  @ApiProperty({ format: 'date-time' })
  endAt!: Date;
  @ApiProperty({ type: 'integer' })
  capacity!: number;
  @ApiProperty({ enum: ClassSessionStatus })
  status!: ClassSessionStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  cancellationReason!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  attendanceClosedAt!: Date | null;
  @ApiProperty({ type: ClassSessionScheduleDto })
  schedule!: ClassSessionScheduleDto;
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

export class ClassSessionListResponseDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Sólo para today=true',
  })
  readAt?: Date;
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    description: 'Sólo para today=true',
  })
  businessDate?: string;
  @ApiPropertyOptional({
    type: String,
    description: 'Zona IANA; sólo para today=true',
  })
  timeZone?: string;
  @ApiProperty({ type: [ClassSessionResponseDto] })
  items!: ClassSessionResponseDto[];
  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}

export class ClassSessionGenerationResponseDto {
  @ApiProperty({ type: 'integer' })
  candidateCount!: number;
  @ApiProperty({ type: 'integer' })
  createdCount!: number;
  @ApiProperty({ type: 'integer' })
  existingCount!: number;
  @ApiProperty({ example: 'America/Argentina/Buenos_Aires' })
  timeZone!: string;
}

class ExpectedStudentDto {
  @ApiProperty({ enum: ParticipationOrigin }) origin!: ParticipationOrigin;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) recoveryId!:
    string | null;
  @ApiProperty({ format: 'uuid' })
  studentId!: string;
  @ApiProperty()
  fullName!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  enrollmentId!: string | null;
  @ApiProperty({ format: 'uuid' })
  subscriptionId!: string;
}

export class ExpectedStudentsResponseDto {
  @ApiProperty({ format: 'uuid' })
  classSessionId!: string;
  @ApiProperty({ enum: ClassSessionStatus })
  classSessionStatus!: ClassSessionStatus;
  @ApiProperty({ description: 'Siempre false para una clase cancelada' })
  attendanceRequired!: boolean;
  @ApiProperty({ type: [ExpectedStudentDto] })
  items!: ExpectedStudentDto[];
}
