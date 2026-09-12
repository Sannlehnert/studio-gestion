import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, Length } from 'class-validator';
import { CHALLENGE_PATTERN } from '../attendance-challenge';

export class MarkPresentDto {
  @ApiProperty({
    description:
      'Secreto efímero opaco obtenido del QR. Sensible; enviar únicamente en body.',
    minLength: 47,
    maxLength: 47,
    writeOnly: true,
  })
  @IsString()
  @Length(47, 47)
  @Matches(CHALLENGE_PATTERN, { message: 'Formato de challenge inválido' })
  challenge!: string;
}

export class AttendanceChallengeResponseDto {
  @ApiProperty({
    description:
      'Secreto efímero opaco. Sólo se devuelve al emitirlo; no almacenar ni registrar.',
    minLength: 47,
    maxLength: 47,
  })
  challenge!: string;

  @ApiProperty({ format: 'uuid' })
  classSessionId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: Date;
}
