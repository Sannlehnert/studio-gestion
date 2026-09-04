import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export function normalizeStudentName(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value;
}

export class CreateStudentDto {
  @ApiProperty({ example: 'Martina López', minLength: 2, maxLength: 120 })
  @Transform(({ value }) => normalizeStudentName(value))
  @IsString()
  @Length(2, 120)
  fullName!: string;
}

export class UpdateStudentDto extends CreateStudentDto {}
