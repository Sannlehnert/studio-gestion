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
let url;
try {
  url = new URL(rawUrl ?? '');
} catch {
  throw new Error('TEST_DATABASE_URL no tiene un formato válido');
}
if (
  !['postgres:', 'postgresql:'].includes(url.protocol) ||
  !url.pathname.endsWith('_test')
) {
  throw new Error(
    'La validación de migración requiere una base PostgreSQL explícita terminada en _test',
  );
}

const schema = 'migration_' + randomUUID().replaceAll('-', '');
url.searchParams.set('schema', schema);
const environment = {
  ...process.env,
  DATABASE_URL: url.toString(),
  NODE_ENV: 'test',
};
const scratch = mkdtempSync(join(tmpdir(), 'students-migration-'));
const scratchPrisma = join(scratch, 'prisma');
const sourcePrisma = join(backend, 'prisma');
const phaseZero = ['20260901172237_init', '20260901175203_add_session'];
const studentMigration = '20260903120000_add_student_active_status';
const { PrismaClient, Prisma } = require('@prisma/client');
const prisma = new PrismaClient({ datasourceUrl: url.toString() });
let connected = false;

function deploy() {
  execFileSync(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      join(scratchPrisma, 'schema.prisma'),
    ],
    { cwd: backend, env: environment, stdio: 'inherit' },
  );
}

try {
  mkdirSync(join(scratchPrisma, 'migrations'), { recursive: true });
  await prisma.$connect();
  connected = true;
  cpSync(
    join(sourcePrisma, 'schema.prisma'),
    join(scratchPrisma, 'schema.prisma'),
    {
      recursive: false,
    },
  );
  cpSync(
    join(sourcePrisma, 'migrations', 'migration_lock.toml'),
    join(scratchPrisma, 'migrations', 'migration_lock.toml'),
  );
  for (const migration of phaseZero) {
    cpSync(
      join(sourcePrisma, 'migrations', migration),
      join(scratchPrisma, 'migrations', migration),
      {
        recursive: true,
      },
    );
  }
  deploy();

  const id = randomUUID();
  const fullName = 'Alumna existente antes de Etapa 1';
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Student" ("id", "fullName", "createdAt", "updatedAt")
    VALUES (${id}, ${fullName}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  cpSync(
    join(sourcePrisma, 'migrations', studentMigration),
    join(scratchPrisma, 'migrations', studentMigration),
    { recursive: true },
  );
  deploy();
  const rows = await prisma.$queryRaw(
    Prisma.sql`SELECT "fullName", "isActive" FROM "Student" WHERE "id" = ${id}`,
  );
  if (
    rows.length !== 1 ||
    rows[0].fullName !== fullName ||
    rows[0].isActive !== true
  ) {
    throw new Error(
      'La migración no preservó la alumna existente con isActive=true',
    );
  }
  const sql = readFileSync(
    join(sourcePrisma, 'migrations', studentMigration, 'migration.sql'),
    'utf8',
  );
  if (!sql.includes('ADD COLUMN') || /\b(DROP|DELETE|TRUNCATE)\b/i.test(sql)) {
    throw new Error(
      'La migración Students contiene una operación no permitida',
    );
  }
  console.log(
    'Migración Students: PASS; fila previa preservada con isActive=true',
  );
} catch (error) {
  console.error(
    'Validación de migración Students no completada:',
    error instanceof Error ? error.name : 'Error',
  );
  process.exitCode = 1;
} finally {
  if (connected) {
    await prisma.$executeRaw(
      Prisma.sql`DROP SCHEMA IF EXISTS ${Prisma.raw('"' + schema + '"')} CASCADE`,
    );
    await prisma.$disconnect();
  }
  rmSync(scratch, { recursive: true, force: true });
}
