import {
  activePeriodContains,
  wasActiveAt,
} from './student-status-history';

describe('historical Student eligibility', () => {
  const first = {
    validFrom: new Date('2026-09-01T12:00:00.000Z'),
    validUntil: new Date('2026-09-02T12:00:00.000Z'),
  };
  const second = {
    validFrom: new Date('2026-09-03T12:00:00.000Z'),
    validUntil: new Date('2026-09-04T12:00:00.000Z'),
  };

  it('uses inclusive starts and exclusive ends', () => {
    expect(activePeriodContains(first, first.validFrom)).toBe(true);
    expect(
      activePeriodContains(first, new Date('2026-09-02T11:59:59.999Z')),
    ).toBe(true);
    expect(activePeriodContains(first, first.validUntil)).toBe(false);
  });

  it('answers before, during and after an open active period', () => {
    const open = {
      validFrom: new Date('2026-09-05T12:00:00.000Z'),
      validUntil: null,
    };
    expect(
      activePeriodContains(open, new Date('2026-09-05T11:59:59.999Z')),
    ).toBe(false);
    expect(activePeriodContains(open, open.validFrom)).toBe(true);
    expect(
      activePeriodContains(open, new Date('2099-01-01T00:00:00.000Z')),
    ).toBe(true);
  });

  it('preserves multiple active and inactive cycles', () => {
    expect(
      wasActiveAt([first, second], new Date('2026-09-01T18:00:00.000Z')),
    ).toBe(true);
    expect(
      wasActiveAt([first, second], new Date('2026-09-02T18:00:00.000Z')),
    ).toBe(false);
    expect(
      wasActiveAt([first, second], new Date('2026-09-03T18:00:00.000Z')),
    ).toBe(true);
    expect(
      wasActiveAt([first, second], new Date('2026-09-04T12:00:00.000Z')),
    ).toBe(false);
  });
});
