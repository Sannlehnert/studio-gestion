import { randomUUID, randomBytes } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { vi } from 'vitest';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service';
import { SessionService } from '../src/auth/services/session.service';
import {
  activationToken,
  createAdmin,
  createTestApp,
  FRONTEND_ORIGIN,
  loginAdmin,
  sessionCookie,
} from './helpers';

describe('Student Auth with PostgreSQL (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let adminCookie: string;
  let studentId: string;
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    const credentials = await createAdmin(app, prisma);
    adminCookie = sessionCookie(
      await loginAdmin(app, credentials.admin.email, credentials.password),
    );
  });
  beforeEach(async () => {
    studentId = (
      await prisma.student.create({ data: { fullName: 'Alumna de prueba' } })
    ).id;
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (app) await app.close();
  });

  const createAccess = () =>
    request(app.getHttpServer())
      .post('/api/v1/admin/students/' + studentId + '/access')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', adminCookie)
      .send({ expiresInDays: 1 })
      .expect(201);
  const activate = (token: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/student/activate')
      .set('Origin', FRONTEND_ORIGIN)
      .send({ token });
  const revoke = (id: string, forStudent = studentId) =>
    request(app.getHttpServer())
      .post(
        '/api/v1/admin/students/' + forStudent + '/access/' + id + '/revoke',
      )
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', adminCookie);

  it('requires Admin authorization and valid identifiers to generate access', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/students/' + studentId + '/access')
      .set('Origin', FRONTEND_ORIGIN)
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/admin/students/not-a-uuid/access')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', adminCookie)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/admin/students/' + randomUUID() + '/access')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', adminCookie)
      .send({})
      .expect(404);
  });
  it('creates a fragment link, activates once and keeps only hashes in persistence', async () => {
    const issued = await createAccess();
    const token = activationToken(issued);
    expect(new URL(issued.body.activationUrl).search).toBe('');
    const response = await activate(token).expect(200);
    expect(response.body.student).toEqual({
      id: studentId,
      fullName: 'Alumna de prueba',
    });
    expect(response.body.sessionToken).toBeUndefined();
    expect(response.body.token).toBeUndefined();
    const access = await prisma.studentAccess.findUniqueOrThrow({
      where: { id: issued.body.accessId },
    });
    expect(access.tokenHash).not.toBe(token);
    expect(access.status).toBe('ACTIVATED');
    expect(access.activatedAt).not.toBeNull();
    await activate(token).expect(401);
    expect(await prisma.session.count({ where: { userId: studentId } })).toBe(
      1,
    );
    const audit = await prisma.auditLog.findMany({
      where: { entityId: access.id },
    });
    expect(audit.map((item) => item.action).sort()).toEqual([
      'STUDENT_ACCESS_ACTIVATED',
      'STUDENT_ACCESS_CREATED',
    ]);
    expect(JSON.stringify(audit)).not.toContain(token);
  });
  it('derives student identity from session and separates Admin/Student permissions', async () => {
    const token = activationToken(await createAccess());
    const cookie = sessionCookie(await activate(token).expect(200));
    const response = await request(app.getHttpServer())
      .get('/api/v1/student/check')
      .set('Cookie', cookie)
      .expect(200);
    expect(response.body.user.role).toBe('STUDENT');
    await request(app.getHttpServer())
      .get('/api/v1/admin/check')
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/student/check')
      .set('Cookie', adminCookie)
      .expect(403);
    await request(app.getHttpServer()).get('/api/v1/student/check').expect(401);
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.user).toMatchObject({
      id: studentId,
      role: 'STUDENT',
      fullName: 'Alumna de prueba',
    });
    await request(app.getHttpServer())
      .post('/api/v1/admin/students/' + studentId + '/access')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', cookie)
      .send({})
      .expect(403);
    const pending = await createAccess();
    await request(app.getHttpServer())
      .post(
        '/api/v1/admin/students/' +
          studentId +
          '/access/' +
          pending.body.accessId +
          '/revoke',
      )
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', cookie)
      .expect(403);
    expect(
      (
        await prisma.studentAccess.findUniqueOrThrow({
          where: { id: pending.body.accessId },
        })
      ).status,
    ).toBe('PENDING');
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer())
      .get('/api/v1/student/check')
      .set('Cookie', cookie)
      .expect(401);
  });
  it('revokes a pending token idempotently, preserving dates and a single audit event', async () => {
    const issued = await createAccess();
    await revoke(issued.body.accessId).expect(204);
    const first = await prisma.studentAccess.findUniqueOrThrow({
      where: { id: issued.body.accessId },
    });
    await revoke(issued.body.accessId).expect(204);
    const second = await prisma.studentAccess.findUniqueOrThrow({
      where: { id: issued.body.accessId },
    });
    expect(second.revokedAt).toEqual(first.revokedAt);
    expect(second.status).toBe('REVOKED');
    await activate(activationToken(issued)).expect(401);
    expect(await prisma.session.count({ where: { userId: studentId } })).toBe(
      0,
    );
    expect(
      await prisma.auditLog.count({
        where: { entityId: second.id, action: 'STUDENT_ACCESS_REVOKED' },
      }),
    ).toBe(1);
  });
  it('does not revoke access belonging to another student', async () => {
    const issued = await createAccess();
    await revoke(issued.body.accessId, randomUUID()).expect(404);
    await activate(activationToken(issued)).expect(200);
  });
  it('does not revoke a session by revoking an already consumed link', async () => {
    const issued = await createAccess();
    const cookie = sessionCookie(
      await activate(activationToken(issued)).expect(200),
    );
    await revoke(issued.body.accessId).expect(409);
    await request(app.getHttpServer())
      .get('/api/v1/student/check')
      .set('Cookie', cookie)
      .expect(200);
  });
  it('rejects expired and unknown tokens without session creation', async () => {
    const issued = await createAccess();
    await prisma.studentAccess.update({
      where: { id: issued.body.accessId },
      data: { expiresAt: new Date(0) },
    });
    await activate(activationToken(issued)).expect(401);
    await activate(randomBytes(32).toString('base64url')).expect(401);
    expect(await prisma.session.count({ where: { userId: studentId } })).toBe(
      0,
    );
  });
  it('allows only one activation when requests arrive concurrently', async () => {
    const token = activationToken(await createAccess());
    const results = await Promise.all([activate(token), activate(token)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
    expect(await prisma.session.count({ where: { userId: studentId } })).toBe(
      1,
    );
    expect(
      await prisma.auditLog.count({
        where: { actorId: studentId, action: 'STUDENT_ACCESS_ACTIVATED' },
      }),
    ).toBe(1);
  });
  it('serializes activation against administrative revocation', async () => {
    const issued = await createAccess();
    const [activation, revocation] = await Promise.all([
      activate(activationToken(issued)),
      revoke(issued.body.accessId),
    ]);
    if (activation.status === 200) {
      expect(revocation.status).toBe(409);
      expect(await prisma.session.count({ where: { userId: studentId } })).toBe(
        1,
      );
    } else {
      expect(activation.status).toBe(401);
      expect(revocation.status).toBe(204);
      expect(await prisma.session.count({ where: { userId: studentId } })).toBe(
        0,
      );
    }
  });
  it('rolls back token consumption if session creation fails', async () => {
    const issued = await createAccess();
    vi.spyOn(app.get(SessionService), 'createSession').mockRejectedValueOnce(
      new Error('simulated internal failure'),
    );
    const failure = await activate(activationToken(issued)).expect(500);
    expect(JSON.stringify(failure.body)).not.toContain(
      'simulated internal failure',
    );
    const stored = await prisma.studentAccess.findUniqueOrThrow({
      where: { id: issued.body.accessId },
    });
    expect(stored.status).toBe('PENDING');
    expect(stored.activatedAt).toBeNull();
    expect(await prisma.session.count({ where: { userId: studentId } })).toBe(
      0,
    );
    await activate(activationToken(issued)).expect(200);
  });
  it('protects token hashes with the PostgreSQL unique constraint', async () => {
    const issued = await createAccess();
    const stored = await prisma.studentAccess.findUniqueOrThrow({
      where: { id: issued.body.accessId },
    });
    await expect(
      prisma.studentAccess.create({
        data: {
          studentId,
          tokenHash: stored.tokenHash,
          expiresAt: stored.expiresAt,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
  it('rejects manipulated fields and CSRF for activation and revocation', async () => {
    const issued = await createAccess();
    const token = activationToken(issued);
    await request(app.getHttpServer())
      .post('/api/v1/auth/student/activate')
      .set('Origin', FRONTEND_ORIGIN)
      .send({ token, studentId: randomUUID(), role: 'ADMIN' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/auth/student/activate')
      .send({ token })
      .expect(403);
    await request(app.getHttpServer())
      .post(
        '/api/v1/admin/students/' +
          studentId +
          '/access/' +
          issued.body.accessId +
          '/revoke',
      )
      .set('Cookie', adminCookie)
      .expect(403);
    expect(
      (
        await prisma.studentAccess.findUniqueOrThrow({
          where: { id: issued.body.accessId },
        })
      ).status,
    ).toBe('PENDING');
  });
});
