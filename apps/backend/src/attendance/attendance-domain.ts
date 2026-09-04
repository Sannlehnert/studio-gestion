import { ClassSessionStatus } from '@prisma/client';

export enum AttendanceWindowStatus {
  UPCOMING = 'UPCOMING',
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export enum ClassAllowanceIntegrity {
  OK = 'OK',
  OVERCONSUMED = 'OVERCONSUMED',
}

export interface AttendanceWindow {
  status: AttendanceWindowStatus;
  opensAt: Date;
  closesAt: Date;
}

export function attendanceWindow(
  session: { startAt: Date; endAt: Date; status: ClassSessionStatus },
  now: Date,
  openBeforeMinutes: number,
  closeAfterMinutes: number,
): AttendanceWindow {
  const opensAt = new Date(
    session.startAt.getTime() - openBeforeMinutes * 60_000,
  );
  const closesAt = new Date(
    session.endAt.getTime() + closeAfterMinutes * 60_000,
  );
  const status =
    session.status === ClassSessionStatus.CANCELLED
      ? AttendanceWindowStatus.CANCELLED
      : now < opensAt
        ? AttendanceWindowStatus.UPCOMING
        : now >= closesAt
          ? AttendanceWindowStatus.CLOSED
          : AttendanceWindowStatus.OPEN;
  return { status, opensAt, closesAt };
}

export function classAllowanceSummary(
  classAllowance: number,
  usedClasses: number,
) {
  const overconsumedClasses = Math.max(0, usedClasses - classAllowance);
  return {
    classAllowance,
    usedClasses,
    remainingClasses: Math.max(0, classAllowance - usedClasses),
    integrityStatus:
      overconsumedClasses === 0
        ? ClassAllowanceIntegrity.OK
        : ClassAllowanceIntegrity.OVERCONSUMED,
    overconsumedClasses,
  };
}
