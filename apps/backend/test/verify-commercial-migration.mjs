import { randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const backend = fileURLToPath(new URL('../', import.meta.url));
const envFile = join(backend, '.env.test');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const rawUrl = process.env.TEST_DATABASE_URL;
let baseUrl;
try {
  baseUrl = new URL(rawUrl ?? '');
} catch {
  throw new Error('TEST_DATABASE_URL no tiene un formato válido');
}
if (
  !['postgres:', 'postgresql:'].includes(baseUrl.protocol) ||
  !baseUrl.pathname.endsWith('_test')
) {
  throw new Error(
    'La validación comercial requiere PostgreSQL de pruebas terminado en _test',
  );
}

const sourcePrisma = join(backend, 'prisma');
const stageOne = [
  '20260901172237_init',
  '20260901175203_add_session',
  '20260903120000_add_student_active_status',
];
const commercial = '20260904090000_commercial_core';
const { PrismaClient, Prisma } = require('@prisma/client');

function prepareScratch(migrations) {
  const scratch = mkdtempSync(join(tmpdir(), 'commercial-migration-'));
  const prismaDir = join(scratch, 'prisma');
  mkdirSync(join(prismaDir, 'migrations'), { recursive: true });
  cpSync(join(sourcePrisma, 'schema.prisma'), join(prismaDir, 'schema.prisma'));
  cpSync(
    join(sourcePrisma, 'migrations', 'migration_lock.toml'),
    join(prismaDir, 'migrations', 'migration_lock.toml'),
  );
  for (const migration of migrations) {
    cpSync(
      join(sourcePrisma, 'migrations', migration),
      join(prismaDir, 'migrations', migration),
      { recursive: true },
    );
  }
  return { scratch, prismaDir };
}

function deploy(prismaDir, url, expectFailure = false) {
  try {
    execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        join(prismaDir, 'schema.prisma'),
      ],
      {
        cwd: backend,
        env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'test' },
        stdio: expectFailure ? 'pipe' : 'inherit',
      },
    );
    if (expectFailure) {
      throw new Error('La migración aceptó histórico incompleto');
    }
  } catch (error) {
    if (!expectFailure) throw error;
    if (
      error instanceof Error &&
      error.message === 'La migración aceptó histórico incompleto'
    ) {
      throw error;
    }
  }
}

async function withSchema(label, operation) {
  const schema = label + '_' + randomUUID().replaceAll('-', '');
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schema);
  const prisma = new PrismaClient({ datasourceUrl: url.toString() });
  await prisma.$connect();
  try {
    await operation(prisma, url);
  } finally {
    await prisma.$executeRaw(
      Prisma.sql`DROP SCHEMA IF EXISTS ${Prisma.raw('"' + schema + '"')} CASCADE`,
    );
    await prisma.$disconnect();
  }
}

try {
  await withSchema('commercial_upgrade', async (prisma, url) => {
    const prepared = prepareScratch(stageOne);
    try {
      deploy(prepared.prismaDir, url);
      const planId = randomUUID();
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "Plan" (
          "id", "name", "description", "classCount", "price",
          "isActive", "createdAt", "updatedAt"
        ) VALUES (
          ${planId}, 'Plan previo', 'Conservar', 8, 40000.00,
          true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `);
      cpSync(
        join(sourcePrisma, 'migrations', commercial),
        join(prepared.prismaDir, 'migrations', commercial),
        { recursive: true },
      );
      deploy(prepared.prismaDir, url);
      const rows = await prisma.$queryRaw(Prisma.sql`
        SELECT "name", "price"::text, "currency", "classCount"
        FROM "Plan" WHERE "id" = ${planId}
      `);
      if (
        rows.length !== 1 ||
        rows[0].name !== 'Plan previo' ||
        rows[0].currency !== 'ARS' ||
        rows[0].classCount !== 8
      ) {
        throw new Error('El upgrade no preservó el Plan existente');
      }
    } finally {
      rmSync(prepared.scratch, { recursive: true, force: true });
    }
  });

  await withSchema('commercial_fresh', async (prisma, url) => {
    const prepared = prepareScratch([...stageOne, commercial]);
    try {
      deploy(prepared.prismaDir, url);
      const result = await prisma.$queryRaw(Prisma.sql`
        SELECT
          to_regclass('"Plan"') IS NOT NULL AS plan,
          to_regclass('"Subscription"') IS NOT NULL AS subscription,
          to_regclass('"Payment"') IS NOT NULL AS payment
      `);
      if (!result[0]?.plan || !result[0]?.subscription || !result[0]?.payment) {
        throw new Error('La migración desde cero no creó el núcleo comercial');
      }
    } finally {
      rmSync(prepared.scratch, { recursive: true, force: true });
    }
  });

  await withSchema('commercial_guard', async (prisma, url) => {
    const prepared = prepareScratch(stageOne);
    try {
      deploy(prepared.prismaDir, url);
      const studentId = randomUUID();
      const planId = randomUUID();
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "Student" ("id", "fullName", "createdAt", "updatedAt")
        VALUES (${studentId}, 'Histórica', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "Plan" (
          "id", "name", "classCount", "price", "isActive", "createdAt", "updatedAt"
        ) VALUES (
          ${planId}, 'Plan histórico', 8, 100.00, true,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `);
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "Subscription" (
          "id", "studentId", "planId", "periodStart", "periodEnd",
          "isActive", "createdAt", "updatedAt"
        ) VALUES (
          ${randomUUID()}, ${studentId}, ${planId},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 month',
          true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `);
      cpSync(
        join(sourcePrisma, 'migrations', commercial),
        join(prepared.prismaDir, 'migrations', commercial),
        { recursive: true },
      );
      deploy(prepared.prismaDir, url, true);
      const rows = await prisma.$queryRaw(
        Prisma.sql`SELECT "isActive" FROM "Subscription" WHERE "studentId" = ${studentId}`,
      );
      if (rows.length !== 1 || rows[0].isActive !== true) {
        throw new Error('El guard no preservó el contrato heredado');
      }
    } finally {
      rmSync(prepared.scratch, { recursive: true, force: true });
    }
  });

  const sql = readFileSync(
    join(sourcePrisma, 'migrations', commercial, 'migration.sql'),
    'utf8',
  );
  for (const required of [
    'Subscription_no_active_overlap',
    'Plan_price_check',
    'Payment_amount_check',
    'Payment_idempotencyKey_key',
  ]) {
    if (!sql.includes(required)) {
      throw new Error('Falta protección SQL: ' + required);
    }
  }
  console.log(
    'Migración comercial: PASS; fresh + upgrade + guard de histórico incompleto',
  );
} catch (error) {
  console.error(
    'Validación de migración comercial no completada:',
    error instanceof Error ? error.message : 'Error',
  );
  process.exitCode = 1;
}
