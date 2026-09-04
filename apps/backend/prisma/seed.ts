import { Prisma, PrismaClient } from '@prisma/client';
import { isEmail } from 'class-validator';
import * as argon2 from 'argon2';
import { PASSWORD_HASH_OPTIONS } from '../src/auth/services/password.service';

const prisma = new PrismaClient();
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (
    !email ||
    !isEmail(email) ||
    !password ||
    password.length < 12 ||
    password.length > 1024
  ) {
    throw new Error(
      'Definir SEED_ADMIN_EMAIL válido y SEED_ADMIN_PASSWORD de 12 a 1024 caracteres',
    );
  }
  const existing = await prisma.admin.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    console.log('Admin ya existe; se conserva su contraseña');
    return;
  }
  const passwordHash = await argon2.hash(password, PASSWORD_HASH_OPTIONS);
  try {
    await prisma.admin.create({ data: { email, passwordHash } });
    console.log('Admin inicial creado');
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      console.log(
        'Admin ya creado por otra ejecución; se conserva su contraseña',
      );
      return;
    }
    throw error;
  }
}
void main()
  .catch(() => {
    console.error(
      'Seed no completado: revisar configuración y conexión de base de datos',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
