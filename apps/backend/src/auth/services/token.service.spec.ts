import { TokenService } from './token.service';
describe('activation and session token primitives', () => {
  const service = new TokenService();
  it('generates independent 256-bit base64url secrets and deterministic hashes', () => {
    const first = service.generateToken();
    const second = service.generateToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
    expect(first).not.toBe(second);
    expect(service.hashToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(service.hashToken(first)).toBe(service.hashToken(first));
    expect(service.hashToken(first)).not.toBe(service.hashToken(second));
  });
  it('compares valid hashes and rejects mismatches or malformed hashes', () => {
    expect(
      service.compareToken('test-token', service.hashToken('test-token')),
    ).toBe(true);
    expect(
      service.compareToken('wrong-token', service.hashToken('test-token')),
    ).toBe(false);
    expect(service.compareToken('test-token', 'invalid')).toBe(false);
  });
});
