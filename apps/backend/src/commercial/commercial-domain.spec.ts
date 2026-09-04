import { PaymentStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import {
  calculateFinancialSummary,
  FinancialStatus,
  OperationalSubscriptionStatus,
  operationalSubscriptionStatus,
} from './commercial-domain';

describe('commercial domain', () => {
  const amount = (value: string) => new Prisma.Decimal(value);

  it.each([
    [[], FinancialStatus.PENDING, '0.00', '40000.00'],
    [
      [{ amount: amount('10000'), status: PaymentStatus.CONFIRMED }],
      FinancialStatus.PARTIAL,
      '10000.00',
      '30000.00',
    ],
    [
      [{ amount: amount('40000'), status: PaymentStatus.CONFIRMED }],
      FinancialStatus.PAID,
      '40000.00',
      '0.00',
    ],
    [
      [{ amount: amount('45000'), status: PaymentStatus.CONFIRMED }],
      FinancialStatus.OVERPAID,
      '45000.00',
      '0.00',
    ],
  ])(
    'derives financial state without floating point',
    (payments, status, paidAmount, remainingAmount) => {
      expect(
        calculateFinancialSummary(amount('40000'), 'ARS', payments),
      ).toEqual({
        agreedAmount: '40000.00',
        paidAmount,
        remainingAmount,
        status,
        currency: 'ARS',
      });
    },
  );

  it('excludes voided payments from the paid amount', () => {
    expect(
      calculateFinancialSummary(amount('10'), 'ARS', [
        { amount: amount('7'), status: PaymentStatus.CONFIRMED },
        { amount: amount('3'), status: PaymentStatus.VOIDED },
      ]),
    ).toMatchObject({
      paidAmount: '7.00',
      remainingAmount: '3.00',
      status: FinancialStatus.PARTIAL,
    });
  });

  it('derives expiration but gives cancellation precedence', () => {
    const now = new Date('2026-09-04T12:00:00Z');
    expect(
      operationalSubscriptionStatus(
        SubscriptionStatus.ACTIVE,
        new Date('2026-09-04T11:59:59Z'),
        now,
      ),
    ).toBe(OperationalSubscriptionStatus.EXPIRED);
    expect(
      operationalSubscriptionStatus(
        SubscriptionStatus.CANCELLED,
        new Date('2099-01-01T00:00:00Z'),
        now,
      ),
    ).toBe(OperationalSubscriptionStatus.CANCELLED);
  });
});
