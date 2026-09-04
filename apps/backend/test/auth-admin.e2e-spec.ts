import { randomBytes } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service';
import {
  createAdmin,
  createTestApp,
  FRONTEND_ORIGIN,
  loginAdmin,
  sessionCookie,
} from './helpers';

describe('Admin Auth with PostgreSQL (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let credentials: Awaited<ReturnType<typeof createAdmin>>;
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    credentials = await createAdmin(app, prisma);
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('logs in, sets an HttpOnly cookie and does not expose session secrets in JSON', async () => {
    const response = await loginAdmin(
      app,
      credentials.admin.email,
      credentials.password,
    );
    expect(response.body.admin).toEqual({
      id: credentials.admin.id,
      email: credentials.admin.email,
    });
    expect(response.body.sessionToken).toBeUndefined();
    expect(response.body.admin.passwordHash).toBeUndefined();
    const cookieHeader = String(response.headers['set-cookie']);
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Lax');
    expect(cookieHeader).toContain('Path=/');
    const token = sessionCookie(response).split('=')[1];
    const stored = await prisma.session.findFirstOrThrow({
      where: { userId: credentials.admin.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.expiresAt.toISOString()).toBe(response.body.expiresAt);
  });
  it.each(['wrong password', 'unknown email'])(
    'rejects %s with generic credentials error',
    async (caseName) => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/admin/login')
        .set('Origin', FRONTEND_ORIGIN)
        .send({
          email:
            caseName === 'unknown email'
              ? 'unknown@example.test'
              : credentials.admin.email,
          password:
            caseName === 'wrong password'
              ? 'wrong-password'
              : credentials.password,
        })
        .expect(401);
      expect(response.body.message).toBe('Credenciales inválidas');
      expect(response.headers['set-cookie']).toBeUndefined();
    },
  );
  it('rejects login CSRF before creating a session', async () => {
    const before = await prisma.session.count();
    await request(app.getHttpServer())
      .post('/api/v1/auth/admin/login')
      .send({ email: credentials.admin.email, password: credentials.password })
      .expect(403);
    expect(await prisma.session.count()).toBe(before);
  });
  it('authorizes admin and resolves /auth/me from the session', async () => {
    const cookie = sessionCookie(
      await loginAdmin(app, credentials.admin.email, credentials.password),
    );
    await request(app.getHttpServer())
      .get('/api/v1/admin/check')
      .set('Cookie', cookie)
      .expect(200);
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.user).toMatchObject({
      id: credentials.admin.id,
      email: credentials.admin.email,
      role: 'ADMIN',
    });
    await request(app.getHttpServer())
      .get('/api/v1/student/check')
      .set('Cookie', cookie)
      .expect(403);
  });
  it('rejects missing, forged and JSON-object cookies', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/check').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', 'session=' + randomBytes(32).toString('base64url'))
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', 'session=j%3A%7B%22role%22%3A%22ADMIN%22%7D')
      .expect(401);
  });
  it('logs out idempotently, persists revocation and clears the browser cookie', async () => {
    const own = await createAdmin(app, prisma);
    const cookie = sessionCookie(
      await loginAdmin(app, own.admin.email, own.password),
    );
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', cookie)
      .expect(204);
    expect(String(response.headers['set-cookie'])).toContain(
      'Expires=Thu, 01 Jan 1970',
    );
    const stored = await prisma.session.findFirstOrThrow({
      where: { userId: own.admin.id },
    });
    expect(stored.revokedAt).not.toBeNull();
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(401);
    expect(
      await prisma.auditLog.count({
        where: { action: 'SESSION_REVOKED', entityId: stored.id },
      }),
    ).toBe(1);
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: stored.id } }))
        .revokedAt,
    ).toEqual(stored.revokedAt);
  });
  it('rejects a persisted expired session', async () => {
    const own = await createAdmin(app, prisma);
    const cookie = sessionCookie(
      await loginAdmin(app, own.admin.email, own.password),
    );
    await prisma.session.updateMany({
      where: { userId: own.admin.id },
      data: { expiresAt: new Date(0) },
    });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(401);
  });
  it('enforces unique session token hashes in PostgreSQL', async () => {
    const stored = await prisma.session.findFirstOrThrow({
      where: { userId: credentials.admin.id },
    });
    await expect(
      prisma.session.create({
        data: {
          userId: stored.userId,
          role: stored.role,
          tokenHash: stored.tokenHash,
          expiresAt: stored.expiresAt,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
  it('starts the backend with PostgreSQL and serves health and OpenAPI', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    await request(app.getHttpServer()).get('/api/docs/').expect(200);
    const schema = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(schema.body.paths['/api/v1/auth/admin/login']).toBeDefined();
    expect(
      schema.body.paths[
        '/api/v1/admin/students/{studentId}/access/{accessId}/revoke'
      ],
    ).toBeDefined();
    for (const route of [
      '/api/v1/admin/check',
      '/api/v1/student/check',
      '/api/v1/auth/me',
    ]) {
      expect(schema.body.paths[route].get.security).toContainEqual({
        session: [],
      });
      expect(
        schema.body.paths[route].get.responses['200'].content[
          'application/json'
        ].schema.$ref,
      ).toBeDefined();
    }
    expect(
      schema.body.paths['/api/v1/health'].get.responses['200'].content[
        'application/json'
      ].schema.$ref,
    ).toBe('#/components/schemas/HealthResponseDto');
    expect(
      schema.body.paths['/api/v1/auth/admin/login'].post.responses['429']
        .content['application/json'].schema.$ref,
    ).toBe('#/components/schemas/ApiErrorDto');
  });
});
