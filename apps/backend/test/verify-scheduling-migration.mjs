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
    'La validación de scheduling requiere PostgreSQL de pruebas terminado en _test',
  );
}

const sourcePrisma = join(backend, 'prisma');
const stageTwo = [
  '20260901172237_init',
  '20260901175203_add_session',
  '20260903120000_add_student_active_status',
  '20260904090000_commercial_core',
];
const scheduling = '20260904180000_scheduling_core';
const { PrismaClient, Prisma } = require('@prisma/client');

function prepareScratch(migrations) {
  const scratch = mkdtempSync(join(tmpdir(), 'scheduling-migration-'));
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
    if (expectFailure) throw new Error('La migración aceptó histórico ambiguo');
  } catch (error) {
    if (!expectFailure) throw error;
    if (
      error instanceof Error &&
      error.message === 'La migración aceptó histórico ambiguo'
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

async function assertCore(prisma) {
  const constraints = await prisma.$queryRaw(Prisma.sql`
    SELECT conname
    FROM pg_constraint
    WHERE conname IN (
      'Schedule_time_check',
      'ClassSession_cancellation_check',
      'Enrollment_no_schedule_overlap'
    )
  `);
  const names = new Set(constraints.map((row) => row.conname));
  const indexes = await prisma.$queryRaw(Prisma.sql`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'ClassSession_scheduleId_occurrenceDate_key'
  `);
  if (names.size !== 3 || indexes.length !== 1) {
    throw new Error('No se crearon todas las invariantes de scheduling');
  }
}

try {
  await withSchema('scheduling_upgrade', async (prisma, url) => {
    const prepared = prepareScratch(stageTwo);
    try {
      deploy(prepared.prismaDir, url);
      const studentId = randomUUID();
      const planId = randomUUID();
      const subscriptionId = randomUUID();
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "Student" (
          "id", "fullName", "isActive", "createdAt", "updatedAt"
        ) VALUES (
          ${studentId}, 'Contrato preservado', true,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `);
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "Plan" (
          "id", "name", "classCount", "price", "currency",
          "isActive", "createdAt", "updatedAt"
        ) VALUES (
          ${planId}, 'Plan preservado', 8, 100.00, 'ARS', true,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `);
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "Subscription" (
          "id", "studentId", "planId", "planName", "classAllowance",
          "agreedPrice", "currency", "periodStart", "periodEnd", "status",
          "createdAt", "updatedAt"
        ) VALUES (
          ${subscriptionId}, ${studentId}, ${planId}, 'Plan preservado', 8,
          100.00, 'ARS', TIMESTAMP '2090-01-01 03:00:00',
          TIMESTAMP '2090-02-01 03:00:00', 'ACTIVE',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `);
      cpSync(
        join(sourcePrisma, 'migrations', scheduling),
        join(prepared.prismaDir, 'migrations', scheduling),
        { recursive: true },
      );
      deploy(prepared.prismaDir, url);
      await assertCore(prisma);
      const columns = await prisma.$queryRaw(Prisma.sql`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND (
            (table_name = 'Schedule' AND column_name = 'startMinute')
            OR (table_name = 'ClassSession' AND column_name = 'occurrenceDate')
            OR (table_name = 'Enrollment' AND column_name = 'validFrom')
          )
      `);
      if (columns.length !== 3) {
        throw new Error('El upgrade no creó el modelo temporal esperado');
      }
      const subscriptions = await prisma.$queryRaw(
        Prisma.sql`SELECT "studentId" FROM "Subscription" WHERE "id" = ${subscriptionId}`,
      );
      if (
        subscriptions.length !== 1 ||
        subscriptions[0].studentId !== studentId
      ) {
        throw new Error('El upgrade no preservó el contrato comercial');
      }
    } finally {
      rmSync(prepared.scratch, { recursive: true, force: true });
    }
  });

  await withSchema('scheduling_fresh', async (prisma, url) => {
    const prepared = prepareScratch([...stageTwo, scheduling]);
    try {
      deploy(prepared.prismaDir, url);
      await assertCore(prisma);
    } finally {
      rmSync(prepared.scratch, { recursive: true, force: true });
    }
  });

  await withSchema('scheduling_guard', async (prisma, url) => {
    const prepared = prepareScratch(stageTwo);
    try {
      deploy(prepared.prismaDir, url);
      const scheduleId = randomUUID();
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "Schedule" (
          "id", "dayOfWeek", "startTime", "endTime", "capacity",
          "isActive", "createdAt", "updatedAt"
        ) VALUES (
          ${scheduleId}, 2, TIMESTAMP '2000-01-01 19:00:00',
          TIMESTAMP '2000-01-01 21:00:00', 20, true,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `);
      cpSync(
        join(sourcePrisma, 'migrations', scheduling),
        join(prepared.prismaDir, 'migrations', scheduling),
        { recursive: true },
      );
      deploy(prepared.prismaDir, url, true);
      const rows = await prisma.$queryRaw(
        Prisma.sql`SELECT "capacity" FROM "Schedule" WHERE "id" = ${scheduleId}`,
      );
      if (rows.length !== 1 || rows[0].capacity !== 20) {
        throw new Error('El guard no preservó el Schedule ambiguo');
      }
    } finally {
      rmSync(prepared.scratch, { recursive: true, force: true });
    }
  });

  const sql = readFileSync(
    join(sourcePrisma, 'migrations', scheduling, 'migration.sql'),
    'utf8',
  );
  for (const required of [
    'Schedule_time_check',
    'ClassSession_scheduleId_occurrenceDate_key',
    'ClassSession_cancellation_check',
    'Enrollment_no_schedule_overlap',
    'Subscription_id_studentId_key',
  ]) {
    if (!sql.includes(required)) {
      throw new Error('Falta protección SQL: ' + required);
    }
  }
  console.log(
    'Migración scheduling: PASS; fresh + contrato comercial preservado + guard de histórico ambiguo',
  );
} catch (error) {
  console.error(
    'Validación de migración scheduling no completada:',
    error instanceof Error ? error.message : 'Error',
  );
  process.exitCode = 1;
}
