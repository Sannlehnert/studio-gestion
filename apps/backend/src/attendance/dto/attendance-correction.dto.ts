import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { AttendanceStatus } from '@prisma/client';
import { AttendanceResponseDto } from './attendance.dto';
import { PageMetaDto } from '../../audit/dto/audit.dto';
export class ManualAttendanceDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
export class CorrectAttendanceDto extends ManualAttendanceDto {
  @ApiProperty({ enum: AttendanceStatus })
  @IsEnum(AttendanceStatus)
  targetStatus!: AttendanceStatus;
}
export class AttendanceCorrectionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) attendanceId!: string;
  @ApiProperty({ type: 'integer' }) sequence!: number;
  @ApiProperty({ enum: AttendanceStatus }) previousStatus!: AttendanceStatus;
  @ApiProperty({ enum: AttendanceStatus }) targetStatus!: AttendanceStatus;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'uuid' }) correctedByAdminId!: string;
  @ApiProperty({ format: 'date-time' }) correctedAt!: Date;
}
export class CorrectAttendanceResponseDto {
  @ApiProperty({ type: AttendanceResponseDto })
  attendance!: AttendanceResponseDto;
  @ApiProperty({
    type: AttendanceCorrectionDto,
    nullable: true,
    description: 'Null para no-op; no crea historial ni auditoría',
  })
  correction!: AttendanceCorrectionDto | null;
}
export class AttendanceCorrectionListDto {
  @ApiProperty({ type: [AttendanceCorrectionDto] })
  items!: AttendanceCorrectionDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
