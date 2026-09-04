import {
  addLocalDays,
  databaseDateToLocalDate,
  exclusiveLocalDateForInstant,
  isoDayOfWeek,
  localDateTimeToInstant,
  localDatesInclusive,
  minuteToTime,
  timeToMinute,
} from './business-time';

describe('business local time', () => {
  it('converts recurrence minutes without depending on the host timezone', () => {
    expect(timeToMinute('19:30')).toBe(1170);
    expect(minuteToTime(1170)).toBe('19:30');
    expect(
      localDateTimeToInstant(
        '2026-09-08',
        19 * 60,
        'America/Argentina/Buenos_Aires',
      ).toISOString(),
    ).toBe('2026-09-08T22:00:00.000Z');
  });

  it('handles a configurable timezone with daylight-saving changes', () => {
    expect(
      localDateTimeToInstant(
        '2026-07-15',
        9 * 60,
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-07-15T13:00:00.000Z');
    expect(
      localDateTimeToInstant(
        '2026-12-15',
        9 * 60,
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-12-15T14:00:00.000Z');
  });

  it('rejects nonexistent and repeated local times instead of guessing', () => {
    expect(() =>
      localDateTimeToInstant('2026-03-08', 2 * 60 + 30, 'America/New_York'),
    ).toThrow(/inequívoca/);
    expect(() =>
      localDateTimeToInstant('2026-11-01', 1 * 60 + 30, 'America/New_York'),
    ).toThrow(/inequívoca/);
  });

  it('validates dates and generates an inclusive bounded range', () => {
    expect(localDatesInclusive('2026-09-01', '2026-09-03', 3)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
    expect(isoDayOfWeek('2026-09-08')).toBe(2);
    expect(addLocalDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(() => localDatesInclusive('2026-02-30', '2026-03-01', 10)).toThrow();
  });

  it('derives an exclusive local date from a contract instant', () => {
    const zone = 'America/Argentina/Buenos_Aires';
    expect(
      exclusiveLocalDateForInstant(new Date('2026-10-01T03:00:00Z'), zone),
    ).toBe('2026-10-01');
    expect(
      exclusiveLocalDateForInstant(new Date('2026-10-01T15:00:00Z'), zone),
    ).toBe('2026-10-02');
    expect(databaseDateToLocalDate(new Date('2026-09-01T00:00:00Z'))).toBe(
      '2026-09-01',
    );
  });
});
