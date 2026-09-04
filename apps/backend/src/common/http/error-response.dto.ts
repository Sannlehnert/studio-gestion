import { ApiProperty } from '@nestjs/swagger';
export class ApiErrorDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
  @ApiProperty({ description: 'Ruta sin query string' }) path!: string;
  @ApiProperty() error!: string;
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  message!: string | string[];
}
