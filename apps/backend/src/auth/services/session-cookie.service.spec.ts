import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { vi } from 'vitest';
import { validate } from '../../config/env.validation';
import { SessionCookieService } from './session-cookie.service';

describe('session cookies', () => {
  const config = new ConfigService(
    validate({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://test:test@localhost/studio_test',
      FRONTEND_ORIGIN: 'https://studio.example.test',
      API_ORIGIN: 'https://api.example.test',
    }),
  );
  const service = new SessionCookieService(config);
  it('sets a host-only secure HttpOnly cookie with the stored absolute expiry', () => {
    const cookie = vi.fn();
    const expiresAt = new Date('2026-09-03T12:00:00Z');
    service.set({ cookie } as unknown as Response, 'x'.repeat(43), expiresAt);
    expect(cookie).toHaveBeenCalledWith('__Host-session', 'x'.repeat(43), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  });
  it.each([undefined, { role: 'ADMIN' }, ['token'], 'short', 'x'.repeat(44)])(
    'rejects malformed cookie values',
    (value) => {
      expect(
        service.read({ cookies: { '__Host-session': value } }),
      ).toBeUndefined();
    },
  );
  it('accepts only the configured session cookie', () => {
    expect(
      service.read({ cookies: { '__Host-session': 'x'.repeat(43) } }),
    ).toBe('x'.repeat(43));
    expect(
      service.read({ cookies: { session: 'x'.repeat(43) } }),
    ).toBeUndefined();
  });
  it('clears with the same scope and security options', () => {
    const clearCookie = vi.fn();
    service.clear({ clearCookie } as unknown as Response);
    expect(clearCookie).toHaveBeenCalledWith('__Host-session', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });
});
