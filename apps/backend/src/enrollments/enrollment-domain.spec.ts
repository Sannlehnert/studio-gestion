import {
  EnrollmentOperationalStatus,
  enrollmentOperationalStatus,
  intervalHasWeekday,
  maximumConcurrentEnrollments,
} from './enrollment-domain';

describe('enrollment domain', () => {
  it('uses half-open dates for operational state', () => {
    const interval = { validFrom: '2026-09-01', validUntil: '2026-10-01' };
    expect(enrollmentOperationalStatus(interval, '2026-08-31')).toBe(
      EnrollmentOperationalStatus.UPCOMING,
    );
    expect(enrollmentOperationalStatus(interval, '2026-09-01')).toBe(
      EnrollmentOperationalStatus.ACTIVE,
    );
    expect(enrollmentOperationalStatus(interval, '2026-10-01')).toBe(
      EnrollmentOperationalStatus.EXPIRED,
    );
  });

  it('calculates true maximum overlap with end events before starts', () => {
    expect(
      maximumConcurrentEnrollments([
        { validFrom: '2026-09-01', validUntil: '2026-09-10' },
        { validFrom: '2026-09-10', validUntil: '2026-09-20' },
        { validFrom: '2026-09-05', validUntil: '2026-09-15' },
      ]),
    ).toBe(2);
  });

  it('detects whether the enrollment contains a recurring weekday', () => {
    expect(intervalHasWeekday('2026-09-01', '2026-09-08', 2)).toBe(true);
    expect(intervalHasWeekday('2026-09-02', '2026-09-03', 2)).toBe(false);
  });
});
