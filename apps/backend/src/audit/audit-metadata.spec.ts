import { publicAuditMetadata } from './audit-metadata';
describe('Public audit metadata', () => {
  it('strips secrets and arbitrary nested objects while retaining the event contract', () => {
    expect(
      publicAuditMetadata('STUDENT_UPDATED', {
        before: { fullName: 'Ana', tokenHash: 'secret' },
        after: { fullName: 'Ana María', password: 'secret' },
        token: 'secret',
      }),
    ).toEqual({
      before: { fullName: 'Ana' },
      after: { fullName: 'Ana María' },
    });
    expect(
      publicAuditMetadata('ATTENDANCE_CHALLENGE_ISSUED', {
        classSessionId: 'id',
        challenge: 'secret',
        tokenHash: 'secret',
        rotated: true,
      }),
    ).toEqual({ classSessionId: 'id', rotated: true });
  });
  it('fails closed for unknown actions, inherited names and malformed values', () => {
    for (const action of ['UNKNOWN', '__proto__', 'constructor'])
      expect(publicAuditMetadata(action, { token: 'secret' })).toEqual({});
    expect(
      publicAuditMetadata('STUDENT_CREATED', {
        fullName: { password: 'secret' },
      }),
    ).toEqual({});
    expect(
      publicAuditMetadata('STUDENT_CREATED', { fullName: 'a'.repeat(501) }),
    ).toEqual({});
    expect(publicAuditMetadata('STUDENT_CREATED', null)).toEqual({});
  });
});
