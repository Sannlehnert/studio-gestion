import { Transform, Type } from 'class-transformer';
import {
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

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 100000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class UpdateClassSessionCapacityDto {
  @ApiProperty({ minimum: 1, maximum: 1000 })
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
  @ApiProperty({ minimum: 1, maximum: 7 })
  dayOfWeek!: number;
  @ApiProperty({ example: '19:00' })
  startTime!: string;
  @ApiProperty({ example: '21:00' })
  endTime!: string;
  @ApiProperty()
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
  @ApiProperty()
  capacity!: number;
  @ApiProperty({ enum: ClassSessionStatus })
  status!: ClassSessionStatus;
  @ApiProperty({ format: 'date-time', nullable: true })
  cancelledAt!: Date | null;
  @ApiProperty({ nullable: true })
  cancellationReason!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true })
  attendanceClosedAt!: Date | null;
  @ApiProperty({ type: ClassSessionScheduleDto })
  schedule!: ClassSessionScheduleDto;
  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

class PageMetaDto {
  @ApiProperty()
  page!: number;
  @ApiProperty()
  limit!: number;
  @ApiProperty()
  total!: number;
  @ApiProperty()
  totalPages!: number;
}

export class ClassSessionListResponseDto {
  @ApiProperty({ type: [ClassSessionResponseDto] })
  items!: ClassSessionResponseDto[];
  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}

export class ClassSessionGenerationResponseDto {
  @ApiProperty()
  candidateCount!: number;
  @ApiProperty()
  createdCount!: number;
  @ApiProperty()
  existingCount!: number;
  @ApiProperty({ example: 'America/Argentina/Buenos_Aires' })
  timeZone!: string;
}

class ExpectedStudentDto {
  @ApiProperty({ format: 'uuid' })
  studentId!: string;
  @ApiProperty()
  fullName!: string;
  @ApiProperty({ format: 'uuid' })
  enrollmentId!: string;
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
