import { BadRequestException } from '@nestjs/common';
export function correctionReason(value: string): string {
  if (
    typeof value !== 'string' ||
    value.trim().length < 3 ||
    value.trim().length > 500
  )
    throw new BadRequestException(
      'El motivo debe tener entre 3 y 500 caracteres',
    );
  return value.trim();
}
