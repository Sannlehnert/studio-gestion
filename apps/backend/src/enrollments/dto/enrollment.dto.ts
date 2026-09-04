import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EnrollmentOperationalStatus } from '../enrollment-domain';

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateEnrollmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  studentId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  subscriptionId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  scheduleId!: string;

  @ApiProperty({ format: 'date', example: '2026-09-01' })
  @IsString()
  @Matches(LOCAL_DATE_PATTERN)
  validFrom!: string;

  @ApiProperty({
    format: 'date',
    example: '2026-10-01',
    description: 'Fecha final exclusiva',
  })
  @IsString()
  @Matches(LOCAL_DATE_PATTERN)
  validUntil!: string;
}

export class EndEnrollmentDto {
  @ApiProperty({
    format: 'date',
    description: 'Nueva fecha final exclusiva',
  })
  @IsString()
  @Matches(LOCAL_DATE_PATTERN)
  validUntil!: string;
}

export class ChangeEnrollmentScheduleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  scheduleId!: string;

  @ApiProperty({
    format: 'date',
    description: 'Primera fecha del nuevo horario',
  })
  @IsString()
  @Matches(LOCAL_DATE_PATTERN)
  effectiveDate!: string;
}

export enum EnrollmentStatusFilter {
  UPCOMING = 'upcoming',
  ACTIVE = 'active',
  EXPIRED = 'expired',
  ALL = 'all',
}

export class ListEnrollmentsQueryDto {
  @ApiPropertyOptional({
    enum: EnrollmentStatusFilter,
    default: EnrollmentStatusFilter.ALL,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsOptional()
  @IsEnum(EnrollmentStatusFilter)
  status: EnrollmentStatusFilter = EnrollmentStatusFilter.ALL;

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

class EnrollmentStudentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  fullName!: string;
}

class EnrollmentScheduleDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  dayOfWeek!: number;
  @ApiProperty({ example: '19:00' })
  startTime!: string;
  @ApiProperty({ example: '21:00' })
  endTime!: string;
  @ApiProperty()
  defaultCapacity!: number;
}

export class EnrollmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  studentId!: string;
  @ApiProperty({ format: 'uuid' })
  subscriptionId!: string;
  @ApiProperty({ format: 'uuid' })
  scheduleId!: string;
  @ApiProperty({ format: 'date' })
  validFrom!: string;
  @ApiProperty({ format: 'date', description: 'Fecha final exclusiva' })
  validUntil!: string;
  @ApiProperty({ enum: EnrollmentOperationalStatus })
  operationalStatus!: EnrollmentOperationalStatus;
  @ApiProperty({ type: EnrollmentStudentDto })
  student!: EnrollmentStudentDto;
  @ApiProperty({ type: EnrollmentScheduleDto })
  schedule!: EnrollmentScheduleDto;
  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class EnrollmentChangeResponseDto {
  @ApiProperty({ type: EnrollmentResponseDto })
  endedEnrollment!: EnrollmentResponseDto;
  @ApiProperty({ type: EnrollmentResponseDto })
  newEnrollment!: EnrollmentResponseDto;
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

export class EnrollmentListResponseDto {
  @ApiProperty({ type: [EnrollmentResponseDto] })
  items!: EnrollmentResponseDto[];
  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}
