import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttendanceSource, AttendanceStatus } from '@prisma/client';
import {
  AttendanceWindowStatus,
  ClassAllowanceIntegrity,
} from '../attendance-domain';

export class UpcomingClassSessionsQueryDto {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 10;
}

export class ClassAllowanceSummaryDto {
  @ApiProperty({ format: 'uuid' })
  subscriptionId!: string;
  @ApiProperty()
  classAllowance!: number;
  @ApiProperty()
  usedClasses!: number;
  @ApiProperty()
  remainingClasses!: number;
  @ApiProperty({ enum: ClassAllowanceIntegrity })
  integrityStatus!: ClassAllowanceIntegrity;
  @ApiProperty()
  overconsumedClasses!: number;
}

export class AttendanceWindowDto {
  @ApiProperty({ enum: AttendanceWindowStatus })
  status!: AttendanceWindowStatus;
  @ApiProperty({ format: 'date-time' })
  opensAt!: Date;
  @ApiProperty({ format: 'date-time', description: 'Límite exclusivo' })
  closesAt!: Date;
}

export class AttendanceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  studentId!: string;
  @ApiProperty({ format: 'uuid' })
  subscriptionId!: string;
  @ApiProperty({ format: 'uuid' })
  classSessionId!: string;
  @ApiProperty({ enum: AttendanceStatus })
  status!: AttendanceStatus;
  @ApiProperty({ enum: AttendanceSource })
  source!: AttendanceSource;
  @ApiProperty({ format: 'date-time' })
  recordedAt!: Date;
}

class StudentClassSessionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'date' })
  occurrenceDate!: string;
  @ApiProperty({ format: 'date-time' })
  startAt!: Date;
  @ApiProperty({ format: 'date-time' })
  endAt!: Date;
}

export class StudentAttendanceResponseDto {
  @ApiProperty({ type: StudentClassSessionDto })
  classSession!: StudentClassSessionDto;
  @ApiProperty({ type: AttendanceWindowDto })
  window!: AttendanceWindowDto;
  @ApiProperty({ type: AttendanceResponseDto, nullable: true })
  attendance!: AttendanceResponseDto | null;
  @ApiProperty({ type: ClassAllowanceSummaryDto })
  classSummary!: ClassAllowanceSummaryDto;
}

export class MarkAttendanceResponseDto extends StudentAttendanceResponseDto {}

export class UpcomingClassSessionsResponseDto {
  @ApiProperty({ type: [StudentAttendanceResponseDto] })
  items!: StudentAttendanceResponseDto[];
}

export enum AdminAttendanceItemState {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  PENDING = 'PENDING',
  NOT_REQUIRED_INACTIVE = 'NOT_REQUIRED_INACTIVE',
  UNRESOLVED = 'UNRESOLVED',
}

class AdminAttendanceStudentDto {
  @ApiProperty({ format: 'uuid' })
  studentId!: string;
  @ApiProperty()
  fullName!: string;
  @ApiProperty({ format: 'uuid' })
  subscriptionId!: string;
  @ApiProperty({ enum: AdminAttendanceItemState })
  state!: AdminAttendanceItemState;
  @ApiProperty({ type: AttendanceResponseDto, nullable: true })
  attendance!: AttendanceResponseDto | null;
}

class AdminAttendanceTotalsDto {
  @ApiProperty()
  expected!: number;
  @ApiProperty()
  present!: number;
  @ApiProperty()
  absent!: number;
  @ApiProperty()
  pending!: number;
  @ApiProperty()
  unresolved!: number;
  @ApiProperty()
  notRequiredInactive!: number;
}

export class AdminClassAttendanceResponseDto {
  @ApiProperty({ format: 'uuid' })
  classSessionId!: string;
  @ApiProperty()
  attendanceRequired!: boolean;
  @ApiProperty({ type: AttendanceWindowDto })
  window!: AttendanceWindowDto;
  @ApiProperty({ type: AdminAttendanceTotalsDto })
  totals!: AdminAttendanceTotalsDto;
  @ApiProperty({ type: [AdminAttendanceStudentDto] })
  items!: AdminAttendanceStudentDto[];
}
