import { validate, Environment } from './env.validation';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:55432/studio_gestion_test',
};
describe('environment validation', () => {
  it('parses false as false and supports an exact configurable allowlist', () => {
    const { app } = validate({
      ...base,
      COOKIE_SECURE: 'false',
      FRONTEND_ORIGINS: 'http://localhost:5173,http://localhost:5174',
    });
    expect(app.cookieSecure).toBe(false);
    expect(app.frontendOrigins).toEqual([
      'http://localhost:5173',
      'http://localhost:5174',
    ]);
    expect(app.environment).toBe(Environment.Test);
    expect(app.attendanceOpenBeforeMinutes).toBe(60);
    expect(app.attendanceCloseAfterMinutes).toBe(60);
    expect(app.attendanceReconcileIntervalMinutes).toBe(5);
    expect(app.rateLimits.attendance).toEqual({ limit: 20, windowMs: 60_000 });
  });
  it.each([
    { COOKIE_SECURE: 'yes' },
    { PORT: '0' },
    { PORT: '3000.5' },
    { ADMIN_SESSION_TTL_MS: '1000' },
    { DATABASE_URL: 'secret-not-a-url' },
    { FRONTEND_ORIGIN: '*' },
    { FRONTEND_ORIGIN: 'https://example.test/path' },
    { FRONTEND_ORIGIN: 'https://user:password@example.test' },
    { FRONTEND_ORIGINS: 'http://localhost:5173, null' },
    { BUSINESS_TIMEZONE: 'Invalid/Timezone' },
    { TRUST_PROXY: 'true' },
    { TRUST_PROXY: '1' },
    { TRUST_PROXY: '0.0.0.0/99' },
    { TRUST_PROXY: '0.0.0.0/0' },
    { RATE_LOGIN_LIMIT: '0' },
    { RATE_ATTENDANCE_LIMIT: '0' },
    { ATTENDANCE_OPEN_BEFORE_MINUTES: '-1' },
    { ATTENDANCE_CLOSE_AFTER_MINUTES: '1441' },
    { ATTENDANCE_RECONCILE_INTERVAL_MINUTES: '0' },
    { SESSION_COOKIE_NAME: '__Host-session', COOKIE_SECURE: false },
  ])('rejects an unsafe or malformed setting: %j', (invalid) => {
    expect(() => validate({ ...base, ...invalid })).toThrow();
  });
  it('requires secure, explicit origins in production', () => {
    expect(() => validate({ ...base, NODE_ENV: 'production' })).toThrow();
    const production = {
      ...base,
      NODE_ENV: 'production',
      FRONTEND_ORIGIN: 'https://studio.example.test',
      API_ORIGIN: 'https://api.example.test',
    };
    expect(validate(production).app.cookieSecure).toBe(true);
    expect(validate(production).app.swaggerEnabled).toBe(false);
    expect(() => validate({ ...production, COOKIE_SECURE: 'false' })).toThrow();
    expect(() =>
      validate({ ...production, SWAGGER_ENABLED: 'true' }),
    ).toThrow();
    expect(() =>
      validate({
        ...production,
        FRONTEND_ORIGIN: 'http://studio.example.test',
      }),
    ).toThrow();
  });
  it('does not echo a database secret in a configuration error', () => {
    try {
      validate({ ...base, DATABASE_URL: 'private-secret' });
    } catch (error) {
      expect(String(error)).not.toContain('private-secret');
    }
  });
});
