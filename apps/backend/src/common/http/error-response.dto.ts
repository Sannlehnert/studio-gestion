import { ApiProperty } from '@nestjs/swagger';
import { ErrorCode } from './error-code';
export class ApiErrorDto {
  @ApiProperty({
    enum: ErrorCode,
    enumName: 'ErrorCode',
    description:
      'Código estable para lógica cliente; message se conserva por compatibilidad.',
  })
  code!: ErrorCode;
  @ApiProperty({ type: 'integer' }) statusCode!: number;
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
  @ApiProperty({ description: 'Ruta sin query string' }) path!: string;
  @ApiProperty() error!: string;
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  message!: string | string[];
}
