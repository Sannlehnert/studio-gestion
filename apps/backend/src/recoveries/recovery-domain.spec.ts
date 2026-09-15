import {
  consumesAllowance,
  recoverableAbsence,
  recoveryState,
  subscriptionCoversRecovery,
} from './recovery-domain';
const start = new Date('2035-01-11T13:00:00Z');
const sub = {
  periodStart: new Date('2035-01-01Z'),
  periodEnd: new Date('2035-02-01Z'),
  status: 'ACTIVE' as const,
  cancelledAt: null,
};
describe('Recovery domain', () => {
  it('only ordinary attendance consumes; recovered absence cannot create a chain', () => {
    expect(consumesAllowance(null)).toBe(true);
    expect(consumesAllowance('recovery')).toBe(false);
    expect(
      recoverableAbsence(
        { status: 'ABSENT', recoveryId: null, classSessionId: 'a' },
        'b',
      ),
    ).toBe(true);
    for (const row of [
      { status: 'PRESENT' as const, recoveryId: null, classSessionId: 'a' },
      { status: 'ABSENT' as const, recoveryId: 'r', classSessionId: 'a' },
      { status: 'ABSENT' as const, recoveryId: null, classSessionId: 'b' },
    ])
      expect(recoverableAbsence(row, 'b')).toBe(false);
  });
  it('uses a half-open period and historical cancellation boundary', () => {
    expect(subscriptionCoversRecovery(sub, sub.periodStart)).toBe(true);
    expect(subscriptionCoversRecovery(sub, sub.periodEnd)).toBe(false);
    expect(
      subscriptionCoversRecovery(
        { ...sub, status: 'CANCELLED', cancelledAt: start },
        start,
      ),
    ).toBe(false);
    expect(
      subscriptionCoversRecovery(
        { ...sub, status: 'CANCELLED', cancelledAt: new Date(+start + 1) },
        start,
      ),
    ).toBe(true);
  });
  it('derives results and unavailability without inventing an administrative cancellation', () => {
    const target = { status: 'SCHEDULED' as const, startAt: start };
    expect(recoveryState(null, 'PRESENT', target, sub, true).state).toBe(
      'COMPLETED',
    );
    expect(recoveryState(null, 'ABSENT', target, sub, true).state).toBe(
      'MISSED',
    );
    expect(
      recoveryState(null, null, { ...target, status: 'CANCELLED' }, sub, true)
        .unavailableReason,
    ).toBe('CLASS_CANCELLED');
    expect(
      recoveryState(
        null,
        null,
        target,
        { ...sub, status: 'CANCELLED', cancelledAt: start },
        true,
      ).unavailableReason,
    ).toBe('SUBSCRIPTION_INELIGIBLE');
    expect(
      recoveryState(null, null, target, sub, false).unavailableReason,
    ).toBe('STUDENT_INACTIVE_AT_START');
    expect(recoveryState(start, null, target, sub, true).state).toBe(
      'CANCELLED',
    );
  });
});
