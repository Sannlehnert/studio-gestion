import { PasswordService } from './password.service';
describe('Argon2id passwords', () => {
  it('uses Argon2id and verifies passwords without accepting malformed hashes', async () => {
    const service = new PasswordService();
    await service.onModuleInit();
    const hash = await service.hash('synthetic-test-password');
    expect(hash).toContain('$argon2id$');
    expect(hash.split('$')[3].split(',').sort()).toEqual([
      'm=65536',
      'p=4',
      't=3',
    ]);
    expect(await service.verify(hash, 'synthetic-test-password')).toBe(true);
    expect(await service.verify(hash, 'wrong-password')).toBe(false);
    expect(
      await service.verify('invalid-hash', 'synthetic-test-password'),
    ).toBe(false);
    await expect(
      service.verifyDummy('unknown-user-password'),
    ).resolves.toBeUndefined();
  });
});
