import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  AttendanceStatus,
  ClassSessionStatus,
  SubscriptionStatus,
} from '@prisma/client';
import {
  AttendanceWindowDto,
  ClassAllowanceSummaryDto,
} from '../attendance/dto/attendance.dto';
import { FinancialSummaryResponseDto } from '../subscriptions/dto/subscription.dto';
import { PageMetaDto, PageQueryDto } from '../audit/dto/audit.dto';

export enum SubscriptionContext {
  CURRENT = 'CURRENT',
  UPCOMING = 'UPCOMING',
  NONE = 'NONE',
}
export enum ParticipationKind {
  REGULAR = 'REGULAR',
  RECOVERY = 'RECOVERY',
}
export class ReadQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    description:
      'Fecha civil del negocio, inclusiva. Rango máximo 366 días cuando se proporcionan ambos límites.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string;
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    description: 'Fecha civil del negocio, inclusiva.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string;
}
export class HistoryQueryDto extends ReadQueryDto {
  @ApiPropertyOptional({ enum: AttendanceStatus })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  effectiveStatus?: AttendanceStatus;
}
export class UpcomingReadQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    default: 10,
    minimum: 1,
    maximum: 20,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 10;
}
export class ReadContextDto {
  @ApiProperty({ type: String, format: 'date-time' }) readAt!: Date;
  @ApiProperty({ type: String, format: 'date' }) businessDate!: string;
  @ApiProperty({ type: String, description: 'Zona IANA del negocio' })
  timeZone!: string;
}
export class ContextSubscriptionDto extends ClassAllowanceSummaryDto {
  @ApiProperty({ type: String }) planName!: string;
  @ApiProperty({ enum: SubscriptionStatus }) status!: SubscriptionStatus;
  @ApiProperty({ type: String, format: 'date-time' }) periodStart!: Date;
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Fin exclusivo',
  })
  periodEnd!: Date;
}
export class SubscriptionSummaryDto extends ReadContextDto {
  @ApiProperty({ enum: SubscriptionContext }) context!: SubscriptionContext;
  @ApiProperty({ type: ContextSubscriptionDto, nullable: true })
  subscription!: ContextSubscriptionDto | null;
}
export class AdminSubscriptionSummaryDto extends SubscriptionSummaryDto {
  @ApiProperty({ type: FinancialSummaryResponseDto, nullable: true })
  financialSummary!: FinancialSummaryResponseDto | null;
}
export class ReadClassDto {
  @ApiProperty({ type: String, format: 'uuid' }) classSessionId!: string;
  @ApiProperty({ type: String, format: 'date' }) occurrenceDate!: string;
  @ApiProperty({ type: String, format: 'date-time' }) startAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) endAt!: Date;
  @ApiProperty({ enum: ClassSessionStatus }) status!: ClassSessionStatus;
}
export class RecoveryHistoryDto {
  @ApiProperty({ type: String, format: 'uuid' }) recoveryId!: string;
  @ApiProperty({ type: ReadClassDto }) originalClass!: ReadClassDto;
}
export class AttendanceHistoryItemDto {
  @ApiProperty({ type: String, format: 'uuid' }) attendanceId!: string;
  @ApiProperty({ type: ReadClassDto }) classSession!: ReadClassDto;
  @ApiProperty({ enum: AttendanceStatus }) effectiveStatus!: AttendanceStatus;
  @ApiProperty({ enum: ParticipationKind })
  participationKind!: ParticipationKind;
  @ApiProperty({ type: Boolean }) corrected!: boolean;
  @ApiProperty({ type: RecoveryHistoryDto, nullable: true })
  recovery!: RecoveryHistoryDto | null;
}
export class AttendanceHistoryDto {
  @ApiProperty({ type: [AttendanceHistoryItemDto] })
  items!: AttendanceHistoryItemDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
export class UpcomingReadItemDto {
  @ApiProperty({ type: ReadClassDto }) classSession!: ReadClassDto;
  @ApiProperty({ enum: ParticipationKind })
  participationKind!: ParticipationKind;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) recoveryId!:
    string | null;
  @ApiProperty({ type: AttendanceHistoryItemDto, nullable: true })
  attendance!: AttendanceHistoryItemDto | null;
  @ApiProperty({ type: AttendanceWindowDto }) window!: AttendanceWindowDto;
}
export class UpcomingReadDto extends ReadContextDto {
  @ApiProperty({ type: [UpcomingReadItemDto] }) items!: UpcomingReadItemDto[];
}
export class StudentHomeSummaryDto extends SubscriptionSummaryDto {
  @ApiProperty({ type: UpcomingReadItemDto, nullable: true })
  nextClass!: UpcomingReadItemDto | null;
  @ApiProperty({
    type: UpcomingReadItemDto,
    nullable: true,
    description:
      'Próxima recuperación sin resultado distinta de nextClass, o null',
  })
  nextRecovery!: UpcomingReadItemDto | null;
}
export class RecoveryOptionDto extends ReadClassDto {
  @ApiProperty({ type: 'integer' }) capacity!: number;
  @ApiProperty({ type: 'integer' }) occupied!: number;
  @ApiProperty({ type: 'integer' }) available!: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 7 }) dayOfWeek!: number;
}
export class RecoveryOptionsDto {
  @ApiProperty({ type: [RecoveryOptionDto] }) items!: RecoveryOptionDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Fotografía informativa; GET no reserva cupo',
  })
  availabilityAsOf!: Date;
  @ApiProperty({ type: String }) timeZone!: string;
  @ApiProperty({ type: String, format: 'date' }) dateFrom!: string;
  @ApiProperty({ type: String, format: 'date' }) dateTo!: string;
}
