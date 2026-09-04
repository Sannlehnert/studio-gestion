import { ClassSessionStatus } from '@prisma/client';
import {
  AttendanceWindowStatus,
  ClassAllowanceIntegrity,
  attendanceWindow,
  classAllowanceSummary,
} from './attendance-domain';

describe('attendance domain', () => {
  const session = {
    startAt: new Date('2026-09-08T22:00:00Z'),
    endAt: new Date('2026-09-09T00:00:00Z'),
    status: ClassSessionStatus.SCHEDULED,
  };

  it('opens inclusively and closes exclusively at exact boundaries', () => {
    expect(
      attendanceWindow(session, new Date('2026-09-08T20:59:59.999Z'), 60, 60)
        .status,
    ).toBe(AttendanceWindowStatus.UPCOMING);
    expect(
      attendanceWindow(session, new Date('2026-09-08T21:00:00.000Z'), 60, 60)
        .status,
    ).toBe(AttendanceWindowStatus.OPEN);
    expect(
      attendanceWindow(session, new Date('2026-09-09T00:59:59.999Z'), 60, 60)
        .status,
    ).toBe(AttendanceWindowStatus.OPEN);
    expect(
      attendanceWindow(session, new Date('2026-09-09T01:00:00.000Z'), 60, 60)
        .status,
    ).toBe(AttendanceWindowStatus.CLOSED);
  });

  it('always reports a cancelled class as not attendable', () => {
    expect(
      attendanceWindow(
        { ...session, status: ClassSessionStatus.CANCELLED },
        new Date('2026-09-08T22:00:00Z'),
        60,
        60,
      ).status,
    ).toBe(AttendanceWindowStatus.CANCELLED);
  });

  it('derives allowance and exposes overconsumption without negative remaining', () => {
    expect(classAllowanceSummary(8, 3)).toEqual({
      classAllowance: 8,
      usedClasses: 3,
      remainingClasses: 5,
      integrityStatus: ClassAllowanceIntegrity.OK,
      overconsumedClasses: 0,
    });
    expect(classAllowanceSummary(1, 2)).toMatchObject({
      remainingClasses: 0,
      integrityStatus: ClassAllowanceIntegrity.OVERCONSUMED,
      overconsumedClasses: 1,
    });
  });
});
