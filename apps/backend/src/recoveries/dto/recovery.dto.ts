import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AttendanceStatus, ClassSessionStatus } from '@prisma/client';
import { RecoveryState, RecoveryUnavailableReason } from '../recovery-domain';

export class AuthorizeRecoveryDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() targetClassSessionId!: string;
}
export class CancelRecoveryDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
export enum RecoveryCancellationFilter {
  ALL = 'all',
  NOT_CANCELLED = 'not_cancelled',
  CANCELLED = 'cancelled',
}
export class StudentRecoveryQueryDto {
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
  @ApiPropertyOptional({
    enum: RecoveryCancellationFilter,
    default: 'all',
    description:
      'Filtro de cancelación manual; el estado operativo se deriva en la respuesta.',
  })
  @IsEnum(RecoveryCancellationFilter)
  cancellation = RecoveryCancellationFilter.ALL;
}
export class AdminRecoveryQueryDto extends StudentRecoveryQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  originalAttendanceId?: string;
}
class RecoveryClassDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date' }) occurrenceDate!: string;
  @ApiProperty({ format: 'date-time' }) startAt!: Date;
  @ApiProperty({ format: 'date-time' }) endAt!: Date;
  @ApiProperty({ enum: ClassSessionStatus }) status!: ClassSessionStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt!: Date | null;
  @ApiProperty({ type: String, nullable: true }) cancellationReason!:
    string | null;
}
class OriginalAbsenceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) classSessionId!: string;
  @ApiProperty({ enum: AttendanceStatus }) status!: AttendanceStatus;
  @ApiProperty({ format: 'date-time' }) recordedAt!: Date;
}
class RecoveryAttendanceDto extends OriginalAbsenceDto {}
export class RecoveryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) studentId!: string;
  @ApiProperty({ format: 'uuid' }) subscriptionId!: string;
  @ApiProperty({ type: OriginalAbsenceDto })
  originalAbsence!: OriginalAbsenceDto;
  @ApiProperty({ type: RecoveryClassDto })
  targetClassSession!: RecoveryClassDto;
  @ApiProperty({ type: RecoveryAttendanceDto, nullable: true })
  attendance!: RecoveryAttendanceDto | null;
  @ApiProperty({ enum: RecoveryState }) state!: RecoveryState;
  @ApiProperty({ enum: RecoveryUnavailableReason, nullable: true })
  unavailableReason!: RecoveryUnavailableReason | null;
  @ApiProperty({ format: 'date-time' }) authorizedAt!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt!: Date | null;
  @ApiProperty({ type: String, nullable: true }) cancellationReason!:
    string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  subscriptionCancelledAt!: Date | null;
}
class PageMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}
export class RecoveryListResponseDto {
  @ApiProperty({ type: [RecoveryResponseDto] }) items!: RecoveryResponseDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
