import { ClassSessionStatus } from '@prisma/client';
import { TokenService } from '../auth/services/token.service';
import {
  assertAttendanceOpen,
  assertChallengeFormat,
  assertChallengeValid,
} from './attendance-challenge';

describe('QR challenge domain', () => {
  const now = new Date('2035-01-10T13:00:00Z');
  const session = {
    status: ClassSessionStatus.SCHEDULED,
    startAt: now,
    endAt: new Date('2035-01-10T14:00:00Z'),
  };
  const valid = {
    classSessionId: 'class-a',
    revokedAt: null,
    expiresAt: new Date(now.getTime() + 60_000),
  };

  it('uses the existing 256-bit opaque token and cryptographic hash', () => {
    const tokens = new TokenService();
    const token = 'sgq_' + tokens.generateToken();
    expect(() => assertChallengeFormat(token)).not.toThrow();
    expect(Buffer.from(token.slice(4), 'base64url')).toHaveLength(32);
    expect(tokens.hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokens.compareToken(token, tokens.hashToken(token))).toBe(true);
    expect(tokens.compareToken(token + 'x', tokens.hashToken(token))).toBe(
      false,
    );
    expect(tokens.generateToken()).not.toBe(token.slice(4));
  });

  it.each([
    undefined,
    null,
    '',
    42,
    [],
    {},
    'sgq_',
    'x'.repeat(100_000),
    'sgq_' + '!'.repeat(43),
  ])('rejects malformed input without echoing it (%#)', (value) => {
    expect(() => assertChallengeFormat(value)).toThrow(
      'Formato de challenge inválido',
    );
  });

  it('uses exclusive expiry, revocation and exact class binding', () => {
    expect(() => assertChallengeValid(valid, 'class-a', now)).not.toThrow();
    for (const [record, id, at] of [
      [valid, 'class-a', valid.expiresAt],
      [valid, 'class-b', now],
      [{ ...valid, revokedAt: now }, 'class-a', now],
      [null, 'class-a', now],
    ] as const)
      expect(() => assertChallengeValid(record, id, at)).toThrow(
        'Challenge no válido',
      );
  });

  it('requires SCHEDULED and the original half-open attendance window', () => {
    expect(() =>
      assertAttendanceOpen(session, new Date('2035-01-10T12:00:00Z'), 60, 60),
    ).not.toThrow();
    for (const at of ['2035-01-10T11:59:59.999Z', '2035-01-10T15:00:00Z']) {
      expect(() =>
        assertAttendanceOpen(session, new Date(at), 60, 60),
      ).toThrow();
    }
    for (const status of [
      ClassSessionStatus.CANCELLED,
      ClassSessionStatus.COMPLETED,
    ]) {
      expect(() =>
        assertAttendanceOpen({ ...session, status }, now, 60, 60),
      ).toThrow();
    }
  });
});
