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
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  FinancialStatus,
  OperationalSubscriptionStatus,
} from '../../commercial/commercial-domain';

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/;
const ZONED_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export class CreateSubscriptionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  studentId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  planId!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-09-01T00:00:00-03:00',
  })
  @IsString()
  @IsISO8601({ strict: true })
  @Matches(ZONED_DATE_TIME_PATTERN)
  periodStart!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-10-01T00:00:00-03:00',
    description: 'Fin exclusivo del período',
  })
  @IsString()
  @IsISO8601({ strict: true })
  @Matches(ZONED_DATE_TIME_PATTERN)
  periodEnd!: string;

  @ApiPropertyOptional({
    example: '35000.00',
    description:
      'Precio acordado excepcional. Si se omite se copia el precio actual del plan.',
    pattern: MONEY_PATTERN.source,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(MONEY_PATTERN)
  agreedPrice?: string;
}

export enum SubscriptionStatusFilter {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  ALL = 'all',
}

export class ListSubscriptionsQueryDto {
  @ApiPropertyOptional({
    enum: SubscriptionStatusFilter,
    default: SubscriptionStatusFilter.ALL,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsOptional()
  @IsEnum(SubscriptionStatusFilter)
  status: SubscriptionStatusFilter = SubscriptionStatusFilter.ALL;

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

class SubscriptionStudentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  fullName!: string;
}

export class SubscriptionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  studentId!: string;
  @ApiProperty({ format: 'uuid' })
  planId!: string;
  @ApiProperty()
  planName!: string;
  @ApiProperty({ type: 'integer' })
  classAllowance!: number;
  @ApiProperty({ type: String, example: '35000.00' })
  agreedPrice!: string;
  @ApiProperty({ enum: ['ARS'] })
  currency!: string;
  @ApiProperty({ format: 'date-time' })
  periodStart!: Date;
  @ApiProperty({ format: 'date-time', description: 'Fin exclusivo' })
  periodEnd!: Date;
  @ApiProperty({ enum: OperationalSubscriptionStatus })
  operationalStatus!: OperationalSubscriptionStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt!: Date | null;
  @ApiProperty({ type: SubscriptionStudentDto })
  student!: SubscriptionStudentDto;
  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class FinancialSummaryResponseDto {
  @ApiProperty({ type: String, example: '40000.00' })
  agreedAmount!: string;
  @ApiProperty({ type: String, example: '30000.00' })
  paidAmount!: string;
  @ApiProperty({ type: String, example: '10000.00' })
  remainingAmount!: string;
  @ApiProperty({ enum: FinancialStatus })
  status!: FinancialStatus;
  @ApiProperty({ enum: ['ARS'] })
  currency!: string;
}

export class SubscriptionDetailResponseDto extends SubscriptionResponseDto {
  @ApiProperty({ type: FinancialSummaryResponseDto })
  financialSummary!: FinancialSummaryResponseDto;
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

export class SubscriptionListResponseDto {
  @ApiProperty({ type: [SubscriptionResponseDto] })
  items!: SubscriptionResponseDto[];
  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}
