import { PaymentStatus, Prisma, SubscriptionStatus } from '@prisma/client';

export enum FinancialStatus {
  PENDING = 'PENDING',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
  OVERPAID = 'OVERPAID',
}

export enum OperationalSubscriptionStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export interface FinancialSummary {
  agreedAmount: string;
  paidAmount: string;
  remainingAmount: string;
  status: FinancialStatus;
  currency: string;
}

export function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

export function calculateFinancialSummary(
  agreedPrice: Prisma.Decimal,
  currency: string,
  payments: ReadonlyArray<{
    amount: Prisma.Decimal;
    status: PaymentStatus;
  }>,
): FinancialSummary {
  const paid = payments.reduce(
    (total, payment) =>
      payment.status === PaymentStatus.CONFIRMED
        ? total.plus(payment.amount)
        : total,
    new Prisma.Decimal(0),
  );
  const comparison = paid.comparedTo(agreedPrice);
  const status =
    comparison === 0
      ? FinancialStatus.PAID
      : comparison > 0
        ? FinancialStatus.OVERPAID
        : paid.isZero()
          ? FinancialStatus.PENDING
          : FinancialStatus.PARTIAL;
  return {
    agreedAmount: money(agreedPrice),
    paidAmount: money(paid),
    remainingAmount: money(
      comparison > 0 ? new Prisma.Decimal(0) : agreedPrice.minus(paid),
    ),
    status,
    currency,
  };
}

export function operationalSubscriptionStatus(
  status: SubscriptionStatus,
  periodEnd: Date,
  now = new Date(),
): OperationalSubscriptionStatus {
  if (status === SubscriptionStatus.CANCELLED) {
    return OperationalSubscriptionStatus.CANCELLED;
  }
  return periodEnd.getTime() <= now.getTime()
    ? OperationalSubscriptionStatus.EXPIRED
    : OperationalSubscriptionStatus.ACTIVE;
}
