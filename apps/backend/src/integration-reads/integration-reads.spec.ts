import {
  historyItem,
  subscriptionContext,
  availableCapacity,
} from './integration-reads.service';
import {
  ErrorCode,
  defaultErrorCode,
  publicErrorCode,
  apiFailure,
} from '../common/http/error-code';
import {
  AllExceptionsFilter,
  errorResponse,
} from '../common/filters/http-exception.filter';
import {
  ArgumentsHost,
  ConflictException,
  HttpException,
} from '@nestjs/common';

describe('Integration projections and public errors', () => {
  const now = new Date('2035-01-10T13:00:00Z');
  it.each([
    [null, 'NONE'],
    [{ periodStart: now }, 'CURRENT'],
    [{ periodStart: new Date(now.getTime() + 1) }, 'UPCOMING'],
  ])('context selection %j', (subscription, expected) => {
    expect(subscriptionContext(subscription, now)).toBe(expected);
  });
  it.each([
    [10, 3, 7],
    [1, 1, 0],
    [1, 2, 0],
  ])('capacity %i occupied %i', (capacity, occupied, available) => {
    expect(availableCapacity(capacity, occupied)).toBe(available);
  });
  it('history retains corrected signal after returning to original, without internals', () => {
    const session = {
      id: 'class',
      occurrenceDate: new Date('2035-01-10Z'),
      startAt: now,
      endAt: now,
      status: 'COMPLETED' as const,
    };
    const item = historyItem({
      id: 'attendance',
      classSessionId: 'class',
      status: 'PRESENT',
      recoveryId: null,
      classSession: session,
      corrections: [{ id: 'correction' }],
      recovery: null,
    });
    expect(item).toMatchObject({
      attendanceId: 'attendance',
      effectiveStatus: 'PRESENT',
      participationKind: 'REGULAR',
      corrected: true,
      recovery: null,
    });
    expect(Object.keys(item).sort()).toEqual([
      'attendanceId',
      'classSession',
      'corrected',
      'effectiveStatus',
      'participationKind',
      'recovery',
    ]);
  });
  it.each([
    [400, 'VALIDATION_FAILED'],
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [429, 'RATE_LIMITED'],
    [500, 'INTERNAL_ERROR'],
  ])('HTTP %i fallback %s', (status, code) => {
    expect(defaultErrorCode(status)).toBe(code);
    expect(
      errorResponse(status, 'safe', '/path?secret=redacted'),
    ).toMatchObject({ code, path: '/path' });
  });
  it('unknown codes cannot expose Prisma or arbitrary metadata', () => {
    expect(publicErrorCode('P2002')).toBeUndefined();
    expect(publicErrorCode({ code: 'INTERNAL_ERROR' })).toBeUndefined();
  });
  it.each([
    [
      new ConflictException(
        apiFailure(ErrorCode.CLASS_SESSION_FULL, 'Sin cupo'),
      ),
      'CLASS_SESSION_FULL',
    ],
    [
      new ConflictException({ message: 'safe', code: 'P2002', sql: 'private' }),
      'CONFLICT',
    ],
    [
      new HttpException(
        { message: 'private', code: 'CLASS_SESSION_FULL' },
        500,
      ),
      'INTERNAL_ERROR',
    ],
  ])('filter preserves only public contract', (exception, code) => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ originalUrl: '/test?secret=value' }),
      }),
    } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(exception, host);
    const body = json.mock.calls[0][0];
    expect(body.code).toBe(code);
    expect(Object.keys(body).sort()).toEqual([
      'code',
      'error',
      'message',
      'path',
      'statusCode',
      'timestamp',
    ]);
    expect(JSON.stringify(body)).not.toMatch(/private|P2002|secret|sql/);
  });
});
