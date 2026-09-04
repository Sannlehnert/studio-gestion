import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const backend = fileURLToPath(new URL('../', import.meta.url));
const testEnv = fileURLToPath(new URL('../.env.test', import.meta.url));
if (existsSync(testEnv)) process.loadEnvFile(testEnv);
const rawUrl = process.env.TEST_DATABASE_URL;
if (!rawUrl)
  throw new Error(
    'Falta TEST_DATABASE_URL. Crear .env.test desde .env.test.example. Nunca se usa DATABASE_URL como fallback.',
  );
let url;
try {
  url = new URL(rawUrl);
} catch {
  throw new Error('TEST_DATABASE_URL no tiene un formato válido');
}
if (
  !['postgres:', 'postgresql:'].includes(url.protocol) ||
  !url.pathname.endsWith('_test')
) {
  throw new Error(
    'TEST_DATABASE_URL debe apuntar explícitamente a una base PostgreSQL con nombre terminado en _test',
  );
}
const schema = 'e2e_' + randomUUID().replaceAll('-', '');
url.searchParams.set('schema', schema);
process.env.DATABASE_URL = url.toString();
process.env.NODE_ENV = 'test';
Object.assign(process.env, {
  FRONTEND_ORIGIN: 'http://localhost:5173',
  FRONTEND_ORIGINS: 'http://localhost:5173',
  API_ORIGIN: 'http://localhost:3000',
  COOKIE_SECURE: 'false',
  SESSION_COOKIE_NAME: 'session',
  SWAGGER_ENABLED: 'true',
  TRUST_PROXY: 'false',
  RATE_API_LIMIT: '1000',
  RATE_LOGIN_LIMIT: '100',
  RATE_ACTIVATION_LIMIT: '100',
  RATE_ACCESS_LIMIT: '100',
});
const { PrismaClient, Prisma } = require('@prisma/client');
const prisma = new PrismaClient({ datasourceUrl: url.toString() });
let databaseReady = false;
try {
  await prisma.$connect();
  databaseReady = true;
  const version = await prisma.$queryRaw(Prisma.sql`SELECT version()`);
  console.log('PostgreSQL de pruebas:', version[0].version);
  execFileSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: backend,
      env: process.env,
      stdio: 'inherit',
    },
  );
  const result = spawnSync(
    process.execPath,
    [
      join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'),
      'run',
      '--config',
      './vitest.config.e2e.ts',
      ...process.argv.slice(2),
    ],
    {
      cwd: backend,
      env: process.env,
      stdio: 'inherit',
    },
  );
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(
    'No se completó E2E:',
    error instanceof Error ? error.name : 'Error',
    error?.code ?? '',
  );
  console.error(
    'Comprobar disponibilidad, credenciales y permisos de la base de pruebas.',
  );
  process.exitCode = 1;
} finally {
  if (databaseReady) {
    // Identifier generated above, never supplied by a request or an environment variable.
    // Only this run's schema inside the explicitly configured *_test database is removed.
    await prisma.$executeRaw(
      Prisma.sql`DROP SCHEMA IF EXISTS ${Prisma.raw('"' + schema + '"')} CASCADE`,
    );
  }
  await prisma.$disconnect();
}
