import { BadRequestException, ConflictException } from '@nestjs/common';
import { ClassSessionStatus } from '@prisma/client';
import { attendanceWindow, AttendanceWindowStatus } from './attendance-domain';

export const CHALLENGE_PATTERN = /^sgq_[A-Za-z0-9_-]{43}$/;

export function assertChallengeFormat(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !CHALLENGE_PATTERN.test(value)) {
    throw new BadRequestException('Formato de challenge inválido');
  }
}

export function assertChallengeValid(
  challenge: {
    classSessionId: string;
    revokedAt: Date | null;
    expiresAt: Date;
  } | null,
  classSessionId: string,
  now: Date,
) {
  if (
    !challenge ||
    challenge.classSessionId !== classSessionId ||
    challenge.revokedAt !== null ||
    challenge.expiresAt <= now
  ) {
    throw new ConflictException('Challenge no válido; escaneá el QR actual');
  }
}

export function assertAttendanceOpen(
  session: { startAt: Date; endAt: Date; status: ClassSessionStatus },
  now: Date,
  openBefore: number,
  closeAfter: number,
) {
  const window = attendanceWindow(session, now, openBefore, closeAfter);
  if (
    session.status !== ClassSessionStatus.SCHEDULED ||
    window.status !== AttendanceWindowStatus.OPEN
  ) {
    throw new ConflictException(
      'La clase no admite asistencia en este momento',
    );
  }
  return window;
}
