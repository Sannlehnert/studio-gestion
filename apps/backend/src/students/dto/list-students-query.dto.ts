import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { normalizeStudentName } from './student-name.dto';

export enum StudentStatusFilter {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ALL = 'all',
}

export class ListStudentsQueryDto {
  @ApiPropertyOptional({
    enum: StudentStatusFilter,
    default: StudentStatusFilter.ACTIVE,
  })
  @IsOptional()
  @IsEnum(StudentStatusFilter)
  status: StudentStatusFilter = StudentStatusFilter.ACTIVE;

  @ApiPropertyOptional({ minimum: 1, maximum: 100_000, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 80,
    description: 'Coincidencia parcial por nombre, sin distinguir mayúsculas',
  })
  @IsOptional()
  @Transform(({ value }) => normalizeStudentName(value))
  @IsString()
  @Length(1, 80)
  search?: string;
}
