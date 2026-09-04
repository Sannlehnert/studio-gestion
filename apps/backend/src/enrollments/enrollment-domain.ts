import { addLocalDays, isoDayOfWeek } from '../time/business-time';

export interface DateInterval {
  validFrom: string;
  validUntil: string;
}

export enum EnrollmentOperationalStatus {
  UPCOMING = 'UPCOMING',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
}

export function enrollmentOperationalStatus(
  interval: DateInterval,
  today: string,
): EnrollmentOperationalStatus {
  if (today < interval.validFrom) return EnrollmentOperationalStatus.UPCOMING;
  if (today >= interval.validUntil) return EnrollmentOperationalStatus.EXPIRED;
  return EnrollmentOperationalStatus.ACTIVE;
}

export function maximumConcurrentEnrollments(
  intervals: ReadonlyArray<DateInterval>,
): number {
  const events = intervals.flatMap((interval) => [
    { date: interval.validFrom, change: 1 },
    { date: interval.validUntil, change: -1 },
  ]);
  events.sort(
    (left, right) =>
      left.date.localeCompare(right.date) || left.change - right.change,
  );
  let current = 0;
  let maximum = 0;
  for (const event of events) {
    current += event.change;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

export function intervalHasWeekday(
  validFrom: string,
  validUntil: string,
  dayOfWeek: number,
) {
  for (
    let date = validFrom;
    date < validUntil && date < addLocalDays(validFrom, 7);
    date = addLocalDays(date, 1)
  ) {
    if (isoDayOfWeek(date) === dayOfWeek) return true;
  }
  return false;
}
