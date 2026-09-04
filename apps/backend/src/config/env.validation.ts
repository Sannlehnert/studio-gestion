import { ConfigService } from '@nestjs/config';
import { isIP } from 'node:net';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}
export interface RatePolicy {
  limit: number;
  windowMs: number;
}
export interface AppSettings {
  environment: Environment;
  port: number;
  businessTimezone: string;
  frontendOrigin: string;
  frontendOrigins: string[];
  apiOrigin: string;
  cookieName: string;
  cookieSecure: boolean;
  adminSessionTtlMs: number;
  studentSessionTtlMs: number;
  swaggerEnabled: boolean;
  bodyLimitBytes: number;
  trustProxy: false | string[];
  rateLimits: Record<'api' | 'login' | 'activation' | 'access', RatePolicy>;
}

export function validate(input: Record<string, unknown>) {
  const environment = input.NODE_ENV ?? Environment.Development;
  if (!Object.values(Environment).includes(environment as Environment)) {
    throw new Error('Configuración inválida: NODE_ENV');
  }
  const production = environment === Environment.Production;
  const text = (key: string, fallback?: string): string => {
    const value = input[key] ?? fallback;
    if (typeof value !== 'string' || !value.trim())
      throw new Error('Configuración inválida: ' + key);
    return value.trim();
  };
  const integer = (
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number => {
    const raw = input[key] ?? fallback;
    const value =
      typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw))
        ? Number(raw)
        : NaN;
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error('Configuración inválida: ' + key);
    return value;
  };
  const boolean = (key: string, fallback: boolean): boolean => {
    const value = input[key] ?? fallback;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new Error('Configuración inválida: ' + key);
  };
  const origin = (value: string, key: string): string => {
    try {
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        value.includes('*') ||
        (production && url.protocol !== 'https:')
      )
        throw new Error();
      return url.origin;
    } catch {
      throw new Error(
        'Configuración inválida: ' + key + ' (se requiere un origin exacto)',
      );
    }
  };
  const databaseUrl = text('DATABASE_URL');
  try {
    const url = new URL(databaseUrl);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length < 2
    )
      throw new Error();
  } catch {
    throw new Error('Configuración inválida: DATABASE_URL');
  }

  const port = integer('PORT', 3000, 1, 65535);
  const frontendOrigin = origin(
    text('FRONTEND_ORIGIN', production ? undefined : 'http://localhost:5173'),
    'FRONTEND_ORIGIN',
  );
  const frontendOrigins = [
    ...new Set([
      frontendOrigin,
      ...text('FRONTEND_ORIGINS', frontendOrigin)
        .split(',')
        .map((item) => origin(item.trim(), 'FRONTEND_ORIGINS')),
    ]),
  ];
  const apiOrigin = origin(
    text('API_ORIGIN', production ? undefined : 'http://localhost:' + port),
    'API_ORIGIN',
  );
  const businessTimezone = text(
    'BUSINESS_TIMEZONE',
    'America/Argentina/Buenos_Aires',
  );
  try {
    new Intl.DateTimeFormat('en', { timeZone: businessTimezone }).format();
  } catch {
    throw new Error('Configuración inválida: BUSINESS_TIMEZONE');
  }
  const cookieSecure = boolean('COOKIE_SECURE', production);
  if (production && !cookieSecure)
    throw new Error('COOKIE_SECURE debe ser true en producción');
  const cookieName = text(
    'SESSION_COOKIE_NAME',
    production ? '__Host-session' : 'session',
  );
  if (
    !/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(cookieName) ||
    ((cookieName.startsWith('__Host-') || cookieName.startsWith('__Secure-')) &&
      !cookieSecure)
  ) {
    throw new Error('Configuración inválida: SESSION_COOKIE_NAME');
  }
  const swaggerEnabled = boolean('SWAGGER_ENABLED', !production);
  if (production && swaggerEnabled)
    throw new Error('Swagger público debe estar deshabilitado en producción');
  const proxyValue = text('TRUST_PROXY', 'false');
  let trustProxy: false | string[] = false;
  if (proxyValue !== 'false') {
    trustProxy = proxyValue.split(',').map((item) => item.trim());
    for (const proxy of trustProxy) {
      const [address, prefix, ...extra] = proxy.split('/');
      const family = isIP(address);
      if (
        !family ||
        extra.length ||
        (prefix !== undefined &&
          (!/^\d+$/.test(prefix) ||
            Number(prefix) === 0 ||
            Number(prefix) > (family === 4 ? 32 : 128)))
      ) {
        throw new Error(
          'TRUST_PROXY admite únicamente IPs o redes CIDR explícitas',
        );
      }
    }
  }
  const rate = (name: string, limit: number, windowMs: number): RatePolicy => ({
    limit: integer('RATE_' + name + '_LIMIT', limit, 1, 100_000),
    windowMs: integer(
      'RATE_' + name + '_WINDOW_MS',
      windowMs,
      1_000,
      86_400_000,
    ),
  });
  const app: AppSettings = {
    environment: environment as Environment,
    port,
    businessTimezone,
    frontendOrigin,
    frontendOrigins,
    apiOrigin,
    cookieName,
    cookieSecure,
    swaggerEnabled,
    trustProxy,
    adminSessionTtlMs: integer(
      'ADMIN_SESSION_TTL_MS',
      86_400_000,
      60_000,
      2_592_000_000,
    ),
    studentSessionTtlMs: integer(
      'STUDENT_SESSION_TTL_MS',
      2_592_000_000,
      60_000,
      7_776_000_000,
    ),
    bodyLimitBytes: integer('BODY_LIMIT_BYTES', 16_384, 1_024, 1_048_576),
    rateLimits: {
      api: rate('API', 300, 60_000),
      login: rate('LOGIN', 10, 900_000),
      activation: rate('ACTIVATION', 60, 900_000),
      access: rate('ACCESS', 30, 900_000),
    },
  };
  return { ...input, DATABASE_URL: databaseUrl, app };
}

export function getSettings(config: ConfigService): AppSettings {
  return config.getOrThrow<AppSettings>('app');
}
