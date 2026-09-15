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
  migration = '20260912180000_recoveries';
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
  const student = await prisma.student.create({
    data: {
      fullName: 'Upgrade Recovery',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  });
  const plan = await prisma.plan.create({
    data: { name: 'Upgrade', price: '100.00', classCount: 4 },
  });
  const sub = await prisma.subscription.create({
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
  const absenceId = randomUUID();
  await prisma.$executeRaw(
    Prisma.sql`INSERT INTO "Attendance" (id,"studentId","subscriptionId","classSessionId",status,source,"recordedAt") VALUES (${absenceId},${student.id},${sub.id},${session.id},'ABSENT','SYSTEM',TIMESTAMP '2026-01-05 15:00:00')`,
  );
  await prisma.$executeRaw(
    Prisma.sql`INSERT INTO "AuditLog" (id,action,entity,"entityId") VALUES (${randomUUID()},'ATTENDANCE_ABSENT_RECORDED','Attendance',${absenceId})`,
  );
  return { student, sub, session, absenceId };
}
async function snapshot(prisma) {
  return JSON.stringify(
    await Promise.all([
      prisma.student.findMany({ orderBy: { id: 'asc' } }),
      prisma.studentActivePeriod.findMany({ orderBy: { id: 'asc' } }),
      prisma.subscription.findMany({ orderBy: { id: 'asc' } }),
      prisma.classSession.findMany({ orderBy: { id: 'asc' } }),
      prisma.$queryRaw(
        Prisma.sql`SELECT id,"studentId","subscriptionId","classSessionId",status::text,source::text,"recordedAt" FROM "Attendance" ORDER BY id`,
      ),
      prisma.auditLog.findMany({
        select: {
          id: true,
          actorId: true,
          action: true,
          entity: true,
          entityId: true,
          metadata: true,
          createdAt: true,
        },
        orderBy: { id: 'asc' },
      }),
    ]),
  );
}
async function assertSchema(prisma) {
  const partials = await prisma.$queryRaw(
    Prisma.sql`SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename='Recovery' AND indexname IN ('Recovery_one_effective_absence_key','Recovery_one_effective_student_session_key')`,
  );
  check(
    partials.length === 2 &&
      partials.every(
        (i) => i.indexdef.includes('UNIQUE') && i.indexdef.includes('WHERE'),
      ),
    'Missing partial uniques',
  );
  const fks = await prisma.$queryRaw(
    Prisma.sql`SELECT confdeltype FROM pg_constraint WHERE conrelid='"Recovery"'::regclass AND contype='f'`,
  );
  check(
    fks.length === 6 && fks.every((f) => f.confdeltype === 'r'),
    'Recovery FKs must RESTRICT history',
  );
  const triggers = await prisma.$queryRaw(
    Prisma.sql`SELECT tgname FROM pg_trigger WHERE tgname IN ('Recovery_history_guard','Attendance_recovery_guard') AND tgrelid IN ('"Recovery"'::regclass,'"Attendance"'::regclass)`,
  );
  check(triggers.length === 2, 'Missing history guards');
  check(
    (await prisma.attendance.count({
      where: { recoveryId: { not: null } },
    })) === 0,
    'Migration invented recovery attendance',
  );
  check(
    (await prisma.recovery.count()) === 0,
    'Migration invented authorization',
  );
}
for (const mode of ['fresh', 'upgrade', 'guard']) {
  const scratch = mkdtempSync(join(tmpdir(), 'recoveries-migration-')),
    dir = join(scratch, 'prisma');
  const schema = 'recovery_' + randomUUID().replaceAll('-', ''),
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
    if (mode !== 'fresh') {
      const f = await fixture(prisma),
        before = await snapshot(prisma);
      if (mode === 'guard')
        await prisma.$executeRaw(
          Prisma.sql`INSERT INTO "Recovery" (id,"studentId","subscriptionId","originalAbsenceId","recoverySessionId") VALUES (${randomUUID()},${f.student.id},${f.sub.id},${f.absenceId},${f.session.id})`,
        );
      cpSync(
        join(source, 'migrations', migration),
        join(dir, 'migrations', migration),
        { recursive: true },
      );
      if (mode === 'guard') {
        let failed = false;
        try {
          deploy(dir, url);
        } catch {
          failed = true;
        }
        check(failed, 'Provisional data was silently migrated');
        const columns = await prisma.$queryRaw(
          Prisma.sql`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Recovery'`,
        );
        check(
          columns.some((c) => c.column_name === 'status') &&
            !columns.some((c) => c.column_name === 'authorizedAt'),
          'Guard did not abort before DDL',
        );
        const [count] = await prisma.$queryRaw(
          Prisma.sql`SELECT count(*)::int AS n FROM "Recovery"`,
        );
        check(count.n === 1, 'Provisional data lost');
      } else {
        deploy(dir, url);
        await assertSchema(prisma);
      }
      check(
        (await snapshot(prisma)) === before,
        'Existing historical data changed',
      );
    } else await assertSchema(prisma);
    console.log(
      'PASS recovery migration:',
      mode,
      '(PostgreSQL real; only isolated test schema)',
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
          join(resolve(tmpdir()), 'recoveries-migration-'),
        ),
      'Unsafe scratch path',
    );
    rmSync(scratch, { recursive: true, force: true });
  }
}
