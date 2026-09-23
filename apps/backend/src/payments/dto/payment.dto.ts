import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
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

const POSITIVE_MONEY_PATTERN = /^(?=.*[1-9])(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/;
const ZONED_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export class RegisterPaymentDto {
  @ApiProperty({
    type: String,
    example: '20000.00',
    description: 'Importe positivo como string, con hasta dos decimales',
    pattern: POSITIVE_MONEY_PATTERN.source,
  })
  @IsString()
  @Matches(POSITIVE_MONEY_PATTERN)
  amount!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-09-04T10:30:00-03:00',
  })
  @IsString()
  @IsISO8601({ strict: true })
  @Matches(ZONED_DATE_TIME_PATTERN)
  paidAt!: string;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note?: string;
}

export class VoidPaymentDto {
  @ApiProperty({
    minLength: 3,
    maxLength: 500,
    example: 'Importe cargado por error',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export enum PaymentStatusFilter {
  CONFIRMED = 'confirmed',
  VOIDED = 'voided',
  ALL = 'all',
}

export class ListPaymentsQueryDto {
  @ApiPropertyOptional({
    enum: PaymentStatusFilter,
    default: PaymentStatusFilter.ALL,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsOptional()
  @IsEnum(PaymentStatusFilter)
  status: PaymentStatusFilter = PaymentStatusFilter.ALL;

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

export class PaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  subscriptionId!: string;
  @ApiProperty({ format: 'uuid' })
  createdByAdminId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  voidedByAdminId!: string | null;
  @ApiProperty({ type: String, example: '20000.00' })
  amount!: string;
  @ApiProperty({ enum: ['ARS'] })
  currency!: string;
  @ApiProperty({ enum: PaymentStatus })
  status!: PaymentStatus;
  @ApiProperty({ format: 'date-time' })
  paidAt!: Date;
  @ApiProperty({ enum: PaymentMethod, nullable: true })
  method!: PaymentMethod | null;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  voidedAt!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  voidReason!: string | null;
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

export class PaymentListResponseDto {
  @ApiProperty({ type: [PaymentResponseDto] })
  items!: PaymentResponseDto[];
  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}
