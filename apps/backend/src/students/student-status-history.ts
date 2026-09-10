import { Prisma } from '@prisma/client';

export type ActivePeriod = {
  validFrom: Date;
  validUntil: Date | null;
};

export function activePeriodContains(
  period: ActivePeriod,
  instant: Date,
): boolean {
  return (
    period.validFrom <= instant &&
    (period.validUntil === null || instant < period.validUntil)
  );
}

export function wasActiveAt(
  periods: ActivePeriod[],
  instant: Date,
): boolean {
  return periods.some((period) => activePeriodContains(period, instant));
}

export function activePeriodAt(
  instant: Date,
): Prisma.StudentActivePeriodWhereInput {
  return {
    validFrom: { lte: instant },
    OR: [{ validUntil: null }, { validUntil: { gt: instant } }],
  };
}
