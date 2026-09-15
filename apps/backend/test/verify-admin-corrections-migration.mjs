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
)
  throw new Error('Requires explicit TEST_DATABASE_URL ending in _test');
const { PrismaClient, Prisma } = require('@prisma/client');
const source = join(backend, 'prisma'),
  migration = '20260915180000_admin_corrections';
const migrations = readdirSync(join(source, 'migrations'))
  .filter((name) => /^\d{14}_/.test(name))
  .sort();
function check(value, message) {
  if (!value) throw new Error(message);
}
function deploy(dir, url) {
  execFileSync(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      join(dir, 'schema.prisma'),
    ],
    {
      cwd: backend,
      env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'test' },
      stdio: 'pipe',
    },
  );
}
async function fixture(prisma) {
  const admin = await prisma.admin.create({
    data: {
      email: randomUUID() + '@migration.test',
      passwordHash: 'fixture-not-a-login',
    },
  });
  const student = await prisma.student.create({
    data: { fullName: 'Historical Student', createdAt: new Date('2026-01-01') },
  });
  const plan = await prisma.plan.create({
    data: { name: 'Historical Plan', classCount: 4, price: '100.00' },
  });
  const subscription = await prisma.subscription.create({
    data: {
      studentId: student.id,
      planId: plan.id,
      planName: plan.name,
      classAllowance: 4,
      agreedPrice: plan.price,
      currency: 'ARS',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-02-01'),
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
  const sessions = [];
  for (const day of [5, 12])
    sessions.push(
      await prisma.classSession.create({
        data: {
          scheduleId: schedule.id,
          occurrenceDate: new Date(`2026-01-${String(day).padStart(2, '0')}`),
          startAt: new Date(
            `2026-01-${String(day).padStart(2, '0')}T13:00:00Z`,
          ),
          endAt: new Date(`2026-01-${String(day).padStart(2, '0')}T14:00:00Z`),
          capacity: 10,
        },
      }),
    );
  const attendanceId = randomUUID();
  await prisma.$executeRaw(
    Prisma.sql`INSERT INTO "Attendance" (id,"studentId","subscriptionId","classSessionId",status,source,"recordedAt") VALUES (${attendanceId},${student.id},${subscription.id},${sessions[0].id},'ABSENT','SYSTEM',TIMESTAMP '2026-01-05 15:00:00')`,
  );
  const recovery = await prisma.recovery.create({
    data: {
      studentId: student.id,
      subscriptionId: subscription.id,
      originalAbsenceId: attendanceId,
      recoverySessionId: sessions[1].id,
      authorizedByAdminId: admin.id,
    },
  });
  await prisma.payment.create({
    data: {
      subscriptionId: subscription.id,
      createdByAdminId: admin.id,
      idempotencyKey: randomUUID(),
      amount: '50.00',
      currency: 'ARS',
      paidAt: new Date('2026-01-01'),
    },
  });
  const cases = [
    ['ADMIN_LOGIN', admin.id, null, 'ADMIN'],
    ['ATTENDANCE_PRESENT_RECORDED', student.id, null, 'STUDENT'],
    ['CLASS_SESSION_ATTENDANCE_RECONCILED', null, null, 'SYSTEM'],
    ['SESSION_REVOKED', student.id, { role: 'STUDENT' }, 'STUDENT'],
    ['SESSION_REVOKED', admin.id, { role: 'ADMIN' }, 'ADMIN'],
  ];
  const actors = [];
  for (const [action, actorId, metadata, expected] of cases) {
    const id = randomUUID();
    actors.push({ id, expected });
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO "AuditLog" (id,"actorId",action,entity,"entityId",metadata) VALUES (${id},${actorId},${action},'Attendance',${attendanceId},${metadata ? JSON.stringify(metadata) : null}::jsonb)`,
    );
  }
  return { attendanceId, actors, recovery };
}
async function snapshot(prisma) {
  const result = [];
  for (const table of [
    'Attendance',
    'Recovery',
    'Payment',
    'AuditLog',
    'Student',
    'StudentActivePeriod',
  ]) {
    // Constant table allowlist; exclude only Stage 7's newly added columns.
    const excluded =
      table === 'Attendance'
        ? ['originalStatus', 'createdByAdminId', 'creationReason']
        : table === 'AuditLog'
          ? ['actorType']
          : [];
    const rows = await prisma.$queryRaw(
      Prisma.sql`SELECT to_jsonb(t) - ${excluded}::text[] AS row FROM ${Prisma.raw('"' + table + '"')} t ORDER BY id`,
    );
    result.push(rows);
  }
  return JSON.stringify(result);
}
async function assertSchema(prisma) {
  const fields = await prisma.$queryRaw(
    Prisma.sql`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Attendance'`,
  );
  check(
    fields.some((x) => x.column_name === 'originalStatus'),
    'Missing originalStatus',
  );
  check(
    (await prisma.attendanceCorrection.count()) === 0,
    'Invented correction history',
  );
  const [checkCount] = await prisma.$queryRaw(
    Prisma.sql`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid='"AttendanceCorrection"'::regclass AND contype='c'`,
  );
  check(checkCount.n === 3, 'Missing correction checks');
}
for (const mode of [
  'fresh',
  'upgrade',
  'guard-unknown',
  'guard-missing-role',
  'guard-null-admin',
]) {
  const scratch = mkdtempSync(join(tmpdir(), 'corrections-migration-')),
    dir = join(scratch, 'prisma');
  const schema = 'corrections_' + randomUUID().replaceAll('-', ''),
    url = new URL(baseUrl);
  url.searchParams.set('schema', schema);
  const prisma = new PrismaClient({ datasourceUrl: url.toString() });
  let connected = false;
  try {
    mkdirSync(join(dir, 'migrations'), { recursive: true });
    cpSync(join(source, 'schema.prisma'), join(dir, 'schema.prisma'));
    cpSync(
      join(source, 'migrations', 'migration_lock.toml'),
      join(dir, 'migrations', 'migration_lock.toml'),
    );
    for (const name of migrations.filter(
      (name) => mode === 'fresh' || name < migration,
    ))
      cpSync(join(source, 'migrations', name), join(dir, 'migrations', name), {
        recursive: true,
      });
    await prisma.$connect();
    connected = true;
    deploy(dir, url);
    if (mode === 'fresh') await assertSchema(prisma);
    else {
      const f = await fixture(prisma);
      if (mode.startsWith('guard')) {
        const action =
          mode === 'guard-unknown'
            ? 'UNRECOGNIZED'
            : mode === 'guard-missing-role'
              ? 'SESSION_REVOKED'
              : 'ADMIN_LOGIN';
        const actorId = mode === 'guard-null-admin' ? null : randomUUID();
        await prisma.$executeRaw(
          Prisma.sql`INSERT INTO "AuditLog" (id,"actorId",action) VALUES (${randomUUID()},${actorId},${action})`,
        );
      }
      const before = await snapshot(prisma);
      cpSync(
        join(source, 'migrations', migration),
        join(dir, 'migrations', migration),
        { recursive: true },
      );
      if (mode.startsWith('guard')) {
        let failed = false;
        try {
          deploy(dir, url);
        } catch {
          failed = true;
        }
        check(failed, 'Ambiguous attribution accepted');
        const fields = await prisma.$queryRaw(
          Prisma.sql`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Attendance'`,
        );
        check(
          !fields.some((x) => x.column_name === 'originalStatus'),
          'Guard ran after DDL',
        );
        const values = await prisma.$queryRaw(
          Prisma.sql`SELECT unnest(enum_range(NULL::"AttendanceSource"))::text AS value`,
        );
        check(!values.some((x) => x.value === 'ADMIN'), 'Guard changed enum');
      } else {
        deploy(dir, url);
        await assertSchema(prisma);
        const record = await prisma.attendance.findUniqueOrThrow({
          where: { id: f.attendanceId },
        });
        check(
          record.originalStatus === 'ABSENT' && record.status === 'ABSENT',
          'Incorrect original backfill',
        );
        for (const actor of f.actors)
          check(
            (
              await prisma.auditLog.findUniqueOrThrow({
                where: { id: actor.id },
              })
            ).actorType === actor.expected,
            'Incorrect historical actor',
          );
        check((await prisma.recovery.count()) === 1, 'Recovery history lost');
        // New guard still blocks an active recovery origin.
        let failed = false;
        try {
          await prisma.attendance.update({
            where: { id: f.attendanceId },
            data: { status: 'PRESENT' },
          });
        } catch {
          failed = true;
        }
        check(failed, 'Recovery guard absent');
      }
      check((await snapshot(prisma)) === before, 'Historical data changed');
    }
    console.log(
      'PASS Stage 7 migration:',
      mode,
      '(isolated PostgreSQL test schema)',
    );
  } finally {
    if (connected)
      await prisma.$executeRaw(
        Prisma.sql`DROP SCHEMA IF EXISTS ${Prisma.raw('"' + schema + '"')} CASCADE`,
      );
    await prisma.$disconnect();
    check(
      dirname(resolve(scratch)) === resolve(tmpdir()) &&
        resolve(scratch).startsWith(
          join(resolve(tmpdir()), 'corrections-migration-'),
        ),
      'Unsafe scratch path',
    );
    rmSync(scratch, { recursive: true, force: true });
  }
}
