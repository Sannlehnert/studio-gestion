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
    'La validación de historial requiere PostgreSQL de pruebas terminado en _test',
  );
}

const sourcePrisma = join(backend, 'prisma');
const stageFour = [
  '20260901172237_init',
  '20260901175203_add_session',
  '20260903120000_add_student_active_status',
  '20260904090000_commercial_core',
  '20260904180000_scheduling_core',
  '20260904220000_attendance_engine',
];
const historyMigration = '20260904233000_historical_student_eligibility';
const { PrismaClient, Prisma } = require('@prisma/client');

function prepareScratch(migrations) {
  const scratch = mkdtempSync(join(tmpdir(), 'student-history-migration-'));
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
  let failed = false;
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
  } catch (error) {
    failed = true;
    if (!expectFailure) throw error;
  }
  if (expectFailure && !failed) {
    throw new Error('La migración aceptó un estado actual no reconstruible');
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

async function insertStudent(prisma, { id, isActive, createdAt, events = [] }) {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Student" ("id", "fullName", "isActive", "createdAt", "updatedAt")
    VALUES (${id}, ${'Migración ' + id}, ${isActive}, ${createdAt}, ${createdAt})
  `);
  for (const event of events) {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "AuditLog" (
        "id", "actorId", "action", "entity", "entityId", "createdAt"
      ) VALUES (
        ${randomUUID()}, NULL, ${event.action}, 'Student', ${id}, ${event.at}
      )
    `);
  }
}

async function assertCore(prisma) {
  const constraints = await prisma.$queryRaw(Prisma.sql`
    SELECT conname, contype, confdeltype
    FROM pg_constraint
    WHERE connamespace = current_schema()::regnamespace
      AND conname IN (
        'StudentActivePeriod_valid_period_check',
        'StudentActivePeriod_no_overlap',
        'StudentActivePeriod_studentId_fkey'
      )
  `);
  const byName = new Map(constraints.map((row) => [row.conname, row]));
  if (
    byName.get('StudentActivePeriod_valid_period_check')?.contype !== 'c' ||
    byName.get('StudentActivePeriod_no_overlap')?.contype !== 'x' ||
    byName.get('StudentActivePeriod_studentId_fkey')?.confdeltype !== 'r'
  ) {
    throw new Error('Faltan invariantes temporales o retención histórica');
  }
  const openIndex = await prisma.$queryRaw(Prisma.sql`
    SELECT i.indisunique, i.indpred IS NOT NULL AS partial
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relname = 'StudentActivePeriod_one_open_period_key'
  `);
  if (
    openIndex.length !== 1 ||
    !openIndex[0].indisunique ||
    !openIndex[0].partial
  ) {
    throw new Error('Falta el unique parcial del período abierto');
  }
  const triggers = await prisma.$queryRaw(Prisma.sql`
    SELECT tgname
    FROM pg_trigger
    WHERE tgrelid IN ('"Student"'::regclass, '"StudentActivePeriod"'::regclass)
      AND tgname IN (
        'Student_create_initial_active_period',
        'Student_active_projection_consistency',
        'StudentActivePeriod_projection_consistency',
        'StudentActivePeriod_prevent_delete'
      )
      AND NOT tgisinternal
  `);
  if (triggers.length !== 4) {
    throw new Error('Faltan los triggers de creación o coherencia de proyección');
  }
}

function serializedPeriods(rows) {
  return rows.map((row) => ({
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil?.toISOString() ?? null,
  }));
}

try {
  await withSchema('student_history_upgrade', async (prisma, url) => {
    const prepared = prepareScratch(stageFour);
    try {
      deploy(prepared.prismaDir, url);
      const created = new Date('2035-01-01T12:00:00.000Z');
      const deactivated = new Date('2035-01-02T12:00:00.000Z');
      const reactivated = new Date('2035-01-03T12:00:00.000Z');
      const deactivatedAgain = new Date('2035-01-04T12:00:00.000Z');
      const activeId = randomUUID();
      const inactiveId = randomUUID();
      const cycledActiveId = randomUUID();
      const cycledInactiveId = randomUUID();
      await insertStudent(prisma, {
        id: activeId,
        isActive: true,
        createdAt: created,
      });
      await insertStudent(prisma, {
        id: inactiveId,
        isActive: false,
        createdAt: created,
        events: [{ action: 'STUDENT_DEACTIVATED', at: deactivated }],
      });
      await insertStudent(prisma, {
        id: cycledActiveId,
        isActive: true,
        createdAt: created,
        events: [
          { action: 'STUDENT_DEACTIVATED', at: deactivated },
          { action: 'STUDENT_REACTIVATED', at: reactivated },
        ],
      });
      await insertStudent(prisma, {
        id: cycledInactiveId,
        isActive: false,
        createdAt: created,
        events: [
          { action: 'STUDENT_DEACTIVATED', at: deactivated },
          { action: 'STUDENT_REACTIVATED', at: reactivated },
          { action: 'STUDENT_DEACTIVATED', at: deactivatedAgain },
        ],
      });

      cpSync(
        join(sourcePrisma, 'migrations', historyMigration),
        join(prepared.prismaDir, 'migrations', historyMigration),
        { recursive: true },
      );
      deploy(prepared.prismaDir, url);
      await assertCore(prisma);

      const periods = async (studentId) =>
        serializedPeriods(
          await prisma.studentActivePeriod.findMany({
            where: { studentId },
            orderBy: { validFrom: 'asc' },
          }),
        );
      if (
        JSON.stringify(await periods(activeId)) !==
        JSON.stringify([
          { validFrom: created.toISOString(), validUntil: null },
        ])
      ) {
        throw new Error('El upgrade no reconstruyó una alumna activa');
      }
      if (
        JSON.stringify(await periods(inactiveId)) !==
        JSON.stringify([
          {
            validFrom: created.toISOString(),
            validUntil: deactivated.toISOString(),
          },
        ])
      ) {
        throw new Error('El upgrade no reconstruyó una alumna inactiva');
      }
      if ((await periods(cycledActiveId)).length !== 2) {
        throw new Error('El upgrade no reconstruyó ciclos activos múltiples');
      }
      const cycledInactive = await periods(cycledInactiveId);
      if (
        cycledInactive.length !== 2 ||
        cycledInactive[1].validUntil !== deactivatedAgain.toISOString()
      ) {
        throw new Error('El upgrade no reconstruyó el ciclo inactivo final');
      }
    } finally {
      rmSync(prepared.scratch, { recursive: true, force: true });
    }
  });

  await withSchema('student_history_fresh', async (prisma, url) => {
    const prepared = prepareScratch([...stageFour, historyMigration]);
    try {
      deploy(prepared.prismaDir, url);
      await assertCore(prisma);
      const id = randomUUID();
      const createdAt = new Date('2035-02-01T12:00:00.000Z');
      await insertStudent(prisma, { id, isActive: true, createdAt });
      const periods = await prisma.studentActivePeriod.findMany({
        where: { studentId: id },
      });
      if (
        periods.length !== 1 ||
        periods[0].validFrom.getTime() !== createdAt.getTime() ||
        periods[0].validUntil !== null
      ) {
        throw new Error('El trigger no creó el período activo inicial');
      }
    } finally {
      rmSync(prepared.scratch, { recursive: true, force: true });
    }
  });

  await withSchema('student_history_guard', async (prisma, url) => {
    const prepared = prepareScratch(stageFour);
    try {
      deploy(prepared.prismaDir, url);
      const id = randomUUID();
      await insertStudent(prisma, {
        id,
        isActive: false,
        createdAt: new Date('2035-03-01T12:00:00.000Z'),
      });
      cpSync(
        join(sourcePrisma, 'migrations', historyMigration),
        join(prepared.prismaDir, 'migrations', historyMigration),
        { recursive: true },
      );
      deploy(prepared.prismaDir, url, true);
      const preserved = await prisma.$queryRaw(
        Prisma.sql`SELECT "isActive" FROM "Student" WHERE "id" = ${id}`,
      );
      const historyTable = await prisma.$queryRaw(Prisma.sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'StudentActivePeriod'
      `);
      if (
        preserved.length !== 1 ||
        preserved[0].isActive !== false ||
        historyTable.length !== 0
      ) {
        throw new Error('El guard no preservó el estado ambiguo sin cambios');
      }
    } finally {
      rmSync(prepared.scratch, { recursive: true, force: true });
    }
  });

  const sql = readFileSync(
    join(sourcePrisma, 'migrations', historyMigration, 'migration.sql'),
    'utf8',
  );
  for (const required of [
    'current status cannot be reconstructed from AuditLog',
    'StudentActivePeriod_valid_period_check',
    'StudentActivePeriod_one_open_period_key',
    'StudentActivePeriod_no_overlap',
    'StudentActivePeriod_studentId_fkey',
    'ON DELETE RESTRICT',
    'Student_create_initial_active_period',
    'Student_active_projection_consistency',
    'StudentActivePeriod_projection_consistency',
    'StudentActivePeriod_prevent_delete',
  ]) {
    if (!sql.includes(required)) {
      throw new Error('Falta protección SQL: ' + required);
    }
  }
  console.log(
    'Migración historial de alumnas: PASS; fresh + Etapa 4 preservada + ciclos reconstruidos + guard ambiguo',
  );
} catch (error) {
  console.error(
    'Validación de migración de historial no completada:',
    error instanceof Error ? error.message : 'Error',
  );
  process.exitCode = 1;
}
