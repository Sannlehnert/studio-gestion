import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const backend = fileURLToPath(new URL('../', import.meta.url));
const envFile = join(backend, '.env.test');
if (existsSync(envFile)) process.loadEnvFile(envFile);
let baseUrl;
try {
  baseUrl = new URL(process.env.TEST_DATABASE_URL ?? '');
} catch {
  throw new Error('TEST_DATABASE_URL no tiene un formato válido');
}
if (
  !['postgres:', 'postgresql:'].includes(baseUrl.protocol) ||
  !baseUrl.pathname.endsWith('_test')
) {
  throw new Error(
    'La validación de attendance requiere PostgreSQL de pruebas terminado en _test',
  );
}

const sourcePrisma = join(backend, 'prisma');
const stageThree = [
  '20260901172237_init',
  '20260901175203_add_session',
  '20260903120000_add_student_active_status',
  '20260904090000_commercial_core',
  '20260904180000_scheduling_core',
];
const attendance = '20260904220000_attendance_engine';
const { PrismaClient, Prisma } = require('@prisma/client');

function prepareScratch(migrations) {
  const scratch = mkdtempSync(join(tmpdir(), 'attendance-migration-'));
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
    SELECT conname, confdeltype
    FROM pg_constraint
    WHERE connamespace = current_schema()::regnamespace
      AND conname IN (
      'ClassSession_attendance_closure_check',
      'Attendance_source_status_check',
      'Attendance_studentId_fkey',
      'Attendance_subscriptionId_studentId_fkey',
      'Attendance_classSessionId_fkey'
    )
  `);
  const names = new Set(constraints.map((row) => row.conname));
  if (names.size !== 5) {
    throw new Error('No se crearon todas las invariantes de attendance');
  }
  const attendanceForeignKeys = constraints.filter(
    (row) =>
      row.conname.startsWith('Attendance_') && row.conname.endsWith('_fkey'),
  );
  if (attendanceForeignKeys.some((row) => row.confdeltype !== 'r')) {
    throw new Error('Attendance permite borrar histórico por cascada');
  }
  const columns = await prisma.$queryRaw(Prisma.sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND (
        (table_name = 'Attendance' AND column_name IN ('subscriptionId', 'source', 'recordedAt'))
        OR (table_name = 'ClassSession' AND column_name = 'attendanceClosedAt')
      )
  `);
  if (columns.length !== 4) {
    throw new Error('Faltan columnas del motor de asistencia');
  }
  const obsolete = await prisma.$queryRaw(Prisma.sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Attendance'
      AND column_name IN ('markedAt', 'note')
  `);
  if (obsolete.length !== 0) {
    throw new Error('Persisten columnas ambiguas del modelo provisional');
  }
  const enumValues = await prisma.$queryRaw(Prisma.sql`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typnamespace = current_schema()::regnamespace
      AND t.typname = 'AttendanceStatus'
    ORDER BY e.enumsortorder
  `);
  if (enumValues.map((row) => row.enumlabel).join(',') !== 'PRESENT,ABSENT') {
    throw new Error('AttendanceStatus conserva estados sin regla de negocio');
  }
}

async function insertStageThreeFixture(
  prisma,
  { withAttendance = false } = {},
) {
  const studentId = randomUUID();
  const planId = randomUUID();
  const subscriptionId = randomUUID();
  const scheduleId = randomUUID();
  const classSessionId = randomUUID();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Student" ("id", "fullName", "isActive", "createdAt", "updatedAt")
    VALUES (${studentId}, 'Histórico asistencia', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Plan" (
      "id", "name", "classCount", "price", "currency", "isActive", "createdAt", "updatedAt"
    ) VALUES (
      ${planId}, 'Plan histórico', 8, 100.00, 'ARS', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Subscription" (
      "id", "studentId", "planId", "planName", "classAllowance", "agreedPrice",
      "currency", "periodStart", "periodEnd", "status", "createdAt", "updatedAt"
    ) VALUES (
      ${subscriptionId}, ${studentId}, ${planId}, 'Plan histórico', 8, 100.00,
      'ARS', TIMESTAMP '2090-01-01 03:00:00', TIMESTAMP '2090-02-01 03:00:00',
      'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Schedule" (
      "id", "dayOfWeek", "startMinute", "endMinute", "defaultCapacity",
      "isActive", "createdAt", "updatedAt"
    ) VALUES (${scheduleId}, 2, 1140, 1260, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "ClassSession" (
      "id", "scheduleId", "occurrenceDate", "startAt", "endAt", "capacity",
      "status", "createdAt", "updatedAt"
    ) VALUES (
      ${classSessionId}, ${scheduleId}, DATE '2090-01-08',
      TIMESTAMP '2090-01-08 22:00:00', TIMESTAMP '2090-01-09 00:00:00',
      10, 'SCHEDULED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Enrollment" (
      "id", "studentId", "subscriptionId", "scheduleId", "validFrom", "validUntil",
      "createdAt", "updatedAt"
    ) VALUES (
      ${randomUUID()}, ${studentId}, ${subscriptionId}, ${scheduleId},
      DATE '2090-01-01', DATE '2090-02-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `);
  if (withAttendance) {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "Attendance" (
        "id", "studentId", "classSessionId", "status", "markedAt", "note"
      ) VALUES (
        ${randomUUID()}, ${studentId}, ${classSessionId}, 'PRESENT', CURRENT_TIMESTAMP, 'sin mapeo'
      )
    `);
  }
  return { studentId, subscriptionId, classSessionId };
}

try {
  await withSchema('attendance_upgrade', async (prisma, url) => {
    const prepared = prepareScratch(stageThree);
    try {
      deploy(prepared.prismaDir, url);
      const fixture = await insertStageThreeFixture(prisma);
      cpSync(
        join(sourcePrisma, 'migrations', attendance),
        join(prepared.prismaDir, 'migrations', attendance),
        { recursive: true },
      );
      deploy(prepared.prismaDir, url);
      await assertCore(prisma);
      const preserved = await prisma.$queryRaw(
        Prisma.sql`SELECT "studentId" FROM "Subscription" WHERE "id" = ${fixture.subscriptionId}`,
      );
      if (
        preserved.length !== 1 ||
        preserved[0].studentId !== fixture.studentId
      ) {
        throw new Error('El upgrade no preservó el contrato comercial');
      }
    } finally {
      rmSync(prepared.scratch, { recursive: true, force: true });
    }
  });

  await withSchema('attendance_fresh', async (prisma, url) => {
    const prepared = prepareScratch([...stageThree, attendance]);
    try {
      deploy(prepared.prismaDir, url);
      await assertCore(prisma);
    } finally {
      rmSync(prepared.scratch, { recursive: true, force: true });
    }
  });

  await withSchema('attendance_guard', async (prisma, url) => {
    const prepared = prepareScratch(stageThree);
    try {
      deploy(prepared.prismaDir, url);
      const fixture = await insertStageThreeFixture(prisma, {
        withAttendance: true,
      });
      cpSync(
        join(sourcePrisma, 'migrations', attendance),
        join(prepared.prismaDir, 'migrations', attendance),
        { recursive: true },
      );
      deploy(prepared.prismaDir, url, true);
      const rows = await prisma.$queryRaw(
        Prisma.sql`SELECT "status", "note" FROM "Attendance" WHERE "classSessionId" = ${fixture.classSessionId}`,
      );
      if (rows.length !== 1 || rows[0].note !== 'sin mapeo') {
        throw new Error('El guard no preservó la asistencia ambigua');
      }
    } finally {
      rmSync(prepared.scratch, { recursive: true, force: true });
    }
  });

  const sql = readFileSync(
    join(sourcePrisma, 'migrations', attendance, 'migration.sql'),
    'utf8',
  );
  for (const required of [
    'Attendance migration requires an explicit mapping',
    'ClassSession_attendance_closure_check',
    'Attendance_source_status_check',
    'Attendance_subscriptionId_studentId_fkey',
    'ON DELETE RESTRICT',
  ]) {
    if (!sql.includes(required)) {
      throw new Error('Falta protección SQL: ' + required);
    }
  }
  console.log(
    'Migración attendance: PASS; fresh + Etapa 3 preservada + guard de histórico ambiguo',
  );
} catch (error) {
  console.error(
    'Validación de migración attendance no completada:',
    error instanceof Error ? error.message : 'Error',
  );
  process.exitCode = 1;
}
