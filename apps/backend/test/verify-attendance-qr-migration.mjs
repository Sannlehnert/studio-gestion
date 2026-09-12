import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const backend = fileURLToPath(new URL('../', import.meta.url));
if (existsSync(join(backend, '.env.test')))
  process.loadEnvFile(join(backend, '.env.test'));
const baseUrl = new URL(process.env.TEST_DATABASE_URL ?? '');
if (
  !['postgres:', 'postgresql:'].includes(baseUrl.protocol) ||
  !baseUrl.pathname.endsWith('_test')
) {
  throw new Error(
    'La validación QR requiere TEST_DATABASE_URL terminado en _test',
  );
}
const { PrismaClient, Prisma } = require('@prisma/client');
const source = join(backend, 'prisma');
const qrMigration = '20260910120000_attendance_challenge';
const migrations = readdirSync(join(source, 'migrations'))
  .filter((name) => /^\d{14}_/.test(name))
  .sort();
function check(condition, message) {
  if (!condition) throw new Error(message);
}
function deploy(prismaDir, url) {
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
      stdio: 'inherit',
    },
  );
}
async function assertQrSchema(prisma) {
  const constraints = await prisma.$queryRaw(Prisma.sql`
    SELECT conname, contype, confdeltype FROM pg_constraint WHERE conrelid = '"AttendanceChallenge"'::regclass
  `);
  check(
    constraints.filter((c) => c.contype === 'c').length === 3,
    'Faltan CHECKs QR',
  );
  check(
    constraints.filter((c) => c.contype === 'f' && c.confdeltype === 'r')
      .length === 2,
    'Faltan FKs RESTRICT',
  );
  const indexes = await prisma.$queryRaw(Prisma.sql`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename = 'AttendanceChallenge'
  `);
  check(indexes.length === 3, 'Índices QR inesperados');
  check(
    indexes.some(
      (i) =>
        i.indexname === 'AttendanceChallenge_tokenHash_key' &&
        i.indexdef.includes('UNIQUE'),
    ),
    'Hash no único',
  );
  check(
    indexes.some(
      (i) =>
        i.indexname === 'AttendanceChallenge_classSessionId_generation_idx',
    ),
    'Falta índice por clase',
  );
  const columns = await prisma.$queryRaw(Prisma.sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'AttendanceChallenge'
  `);
  check(
    !columns.some((c) =>
      ['token', 'challenge', 'secret'].includes(c.column_name),
    ),
    'Existe secreto plano',
  );
  check(
    (await prisma.attendanceChallenge.count()) === 0,
    'Migración inventó challenges',
  );
}
async function historicalFixture(prisma) {
  const student = await prisma.student.create({
    data: {
      fullName: 'Upgrade QR',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  });
  const plan = await prisma.plan.create({
    data: { name: 'Upgrade', price: '100.00', classCount: 4 },
  });
  const subscription = await prisma.subscription.create({
    data: {
      studentId: student.id,
      planId: plan.id,
      planName: plan.name,
      agreedPrice: plan.price,
      classAllowance: 4,
      currency: 'ARS',
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-02-01T00:00:00Z'),
    },
  });
  const schedule = await prisma.schedule.create({
    data: {
      dayOfWeek: 1,
      startMinute: 600,
      endMinute: 660,
      defaultCapacity: 10,
    },
  });
  const session = await prisma.classSession.create({
    data: {
      scheduleId: schedule.id,
      occurrenceDate: new Date('2026-01-05T00:00:00Z'),
      startAt: new Date('2026-01-05T13:00:00Z'),
      endAt: new Date('2026-01-05T14:00:00Z'),
      capacity: 10,
    },
  });
  const attendance = await prisma.attendance.create({
    data: {
      studentId: student.id,
      subscriptionId: subscription.id,
      classSessionId: session.id,
      status: 'PRESENT',
      source: 'STUDENT',
      recordedAt: new Date('2026-01-05T13:05:00Z'),
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: student.id,
      action: 'ATTENDANCE_PRESENT_RECORDED',
      entity: 'Attendance',
      entityId: attendance.id,
    },
  });
}
async function snapshot(prisma) {
  return JSON.stringify(
    await Promise.all([
      prisma.student.findMany(),
      prisma.studentActivePeriod.findMany(),
      prisma.subscription.findMany(),
      prisma.classSession.findMany(),
      prisma.attendance.findMany(),
      prisma.auditLog.findMany(),
    ]),
  );
}

for (const upgrade of [false, true]) {
  const scratch = mkdtempSync(join(tmpdir(), 'attendance-qr-migration-'));
  const prismaDir = join(scratch, 'prisma');
  const schema = 'qr_' + randomUUID().replaceAll('-', '');
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schema);
  const prisma = new PrismaClient({ datasourceUrl: url.toString() });
  let connected = false;
  try {
    mkdirSync(join(prismaDir, 'migrations'), { recursive: true });
    cpSync(join(source, 'schema.prisma'), join(prismaDir, 'schema.prisma'));
    cpSync(
      join(source, 'migrations', 'migration_lock.toml'),
      join(prismaDir, 'migrations', 'migration_lock.toml'),
    );
    for (const name of migrations.filter(
      (name) => !upgrade || name < qrMigration,
    )) {
      cpSync(
        join(source, 'migrations', name),
        join(prismaDir, 'migrations', name),
        { recursive: true },
      );
    }
    await prisma.$connect();
    connected = true;
    deploy(prismaDir, url);
    if (upgrade) {
      await historicalFixture(prisma);
      const before = await snapshot(prisma);
      cpSync(
        join(source, 'migrations', qrMigration),
        join(prismaDir, 'migrations', qrMigration),
        { recursive: true },
      );
      deploy(prismaDir, url);
      check(
        (await snapshot(prisma)) === before,
        'El upgrade modificó datos históricos',
      );
    }
    await assertQrSchema(prisma);
    console.log(
      upgrade
        ? 'PASS upgrade 4.1 -> 5: histórico preservado, constraints e índices'
        : 'PASS fresh: migraciones, constraints e índices',
    );
  } finally {
    if (connected)
      await prisma.$executeRaw(
        Prisma.sql`DROP SCHEMA IF EXISTS ${Prisma.raw('"' + schema + '"')} CASCADE`,
      );
    await prisma.$disconnect();
    // Verify the absolute task-specific directory before removing only this scratch copy.
    check(
      dirname(resolve(scratch)) === resolve(tmpdir()) &&
        resolve(scratch).startsWith(
          join(resolve(tmpdir()), 'attendance-qr-migration-'),
        ),
      'Scratch fuera del directorio esperado',
    );
    rmSync(scratch, { recursive: true, force: true });
  }
}
