const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export interface ZonedDateTimeParts extends LocalDateParts {
  hour: number;
  minute: number;
  second: number;
}

export function parseLocalDate(value: string): LocalDateParts {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) throw new RangeError('Fecha local inválida');
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const roundTrip = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    roundTrip.getUTCFullYear() !== parts.year ||
    roundTrip.getUTCMonth() + 1 !== parts.month ||
    roundTrip.getUTCDate() !== parts.day
  ) {
    throw new RangeError('Fecha local inválida');
  }
  return parts;
}

export function timeToMinute(value: string): number {
  const match = LOCAL_TIME_PATTERN.exec(value);
  if (!match) throw new RangeError('Hora local inválida');
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minuteToTime(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 1439) {
    throw new RangeError('Minuto local inválido');
  }
  return (
    String(Math.floor(value / 60)).padStart(2, '0') +
    ':' +
    String(value % 60).padStart(2, '0')
  );
}

export function localDateToDatabaseDate(value: string): Date {
  const parts = parseLocalDate(value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

export function databaseDateToLocalDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addLocalDays(value: string, days: number): string {
  const parts = parseLocalDate(value);
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return date.toISOString().slice(0, 10);
}

export function isoDayOfWeek(value: string): number {
  const day = localDateToDatabaseDate(value).getUTCDay();
  return day === 0 ? 7 : day;
}

export function compareLocalDates(left: string, right: string): number {
  parseLocalDate(left);
  parseLocalDate(right);
  return left.localeCompare(right);
}

export function localDatesInclusive(from: string, to: string, maxDays: number) {
  if (compareLocalDates(from, to) > 0) {
    throw new RangeError('El rango de fechas está invertido');
  }
  const result: string[] = [];
  for (let value = from; value <= to; value = addLocalDays(value, 1)) {
    result.push(value);
    if (result.length > maxDays) {
      throw new RangeError('El rango de fechas es demasiado amplio');
    }
  }
  return result;
}

function zonedParts(value: Date, timeZone: string): ZonedDateTimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function partsAsUtc(parts: ZonedDateTimeParts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

export function localDateTimeToInstant(
  localDate: string,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const date = parseLocalDate(localDate);
  if (!Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay > 1439) {
    throw new RangeError('Minuto local inválido');
  }
  const target: ZonedDateTimeParts = {
    ...date,
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    second: 0,
  };
  const targetValue = partsAsUtc(target);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const probe = targetValue + hours * 60 * 60 * 1000;
    offsets.add(partsAsUtc(zonedParts(new Date(probe), timeZone)) - probe);
  }
  const candidates = [...offsets]
    .map((offset) => new Date(targetValue - offset))
    .filter(
      (candidate) =>
        partsAsUtc(zonedParts(candidate, timeZone)) === targetValue,
    );
  if (candidates.length === 1) return candidates[0];
  throw new RangeError(
    'La fecha y hora local no existe de forma inequívoca en BUSINESS_TIMEZONE',
  );
}

export function localDateForInstant(value: Date, timeZone: string): string {
  const parts = zonedParts(value, timeZone);
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-');
}

export function localTimeForInstant(value: Date, timeZone: string) {
  const parts = zonedParts(value, timeZone);
  return {
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    millisecond: value.getUTCMilliseconds(),
  };
}

export function exclusiveLocalDateForInstant(value: Date, timeZone: string) {
  const date = localDateForInstant(value, timeZone);
  const time = localTimeForInstant(value, timeZone);
  return time.hour === 0 &&
    time.minute === 0 &&
    time.second === 0 &&
    time.millisecond === 0
    ? date
    : addLocalDays(date, 1);
}
