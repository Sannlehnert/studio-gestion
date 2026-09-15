import { correctionReason } from './attendance-correction-domain';
describe('Administrative reason', () => {
  it('normalizes and accepts the boundaries', () => {
    expect(correctionReason('  abc  ')).toBe('abc');
    expect(correctionReason('a'.repeat(500))).toHaveLength(500);
  });
  it.each(['', '   ', 'ab', 'a'.repeat(501)])(
    'rejects invalid reason %s',
    (value) => {
      expect(() => correctionReason(value)).toThrow();
    },
  );
});
