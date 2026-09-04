import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request, { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { configureApp } from '../src/common/http/configure-app';
import { assertTestDatabase } from './database-safety';

export const FRONTEND_ORIGIN = 'http://localhost:5173';
export async function createTestApp() {
  assertTestDatabase();
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  await configureApp(app);
  return { app, prisma: app.get(PrismaService) };
}
export function sessionCookie(response: Response): string {
  const header: unknown = response.headers['set-cookie'];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (typeof cookie !== 'string')
    throw new Error('No se recibió cookie de sesión');
  return cookie.split(';')[0];
}
export function activationToken(response: Response): string {
  const url = new URL(String(response.body.activationUrl));
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  if (!token)
    throw new Error('No se recibió un token de activación en el fragmento');
  return token;
}
export async function createAdmin(
  app: NestExpressApplication,
  prisma: PrismaService,
) {
  const password = randomBytes(24).toString('base64url');
  const email = 'e2e-' + randomUUID() + '@example.test';
  const passwordHash = await app.get(PasswordService).hash(password);
  const admin = await prisma.admin.create({ data: { email, passwordHash } });
  return { admin, password };
}
export async function loginAdmin(
  app: NestExpressApplication,
  email: string,
  password: string,
) {
  return request(app.getHttpServer())
    .post('/api/v1/auth/admin/login')
    .set('Origin', FRONTEND_ORIGIN)
    .send({ email, password })
    .expect(200);
}
