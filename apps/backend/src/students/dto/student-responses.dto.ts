import { ApiProperty } from '@nestjs/swagger';

export class StudentResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Martina López' }) fullName!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}

export class StudentPageMetaDto {
  @ApiProperty({ type: 'integer', minimum: 1 }) page!: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 }) limit!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) total!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) totalPages!: number;
}

export class StudentListResponseDto {
  @ApiProperty({ type: [StudentResponseDto] }) items!: StudentResponseDto[];
  @ApiProperty({ type: StudentPageMetaDto }) meta!: StudentPageMetaDto;
}
