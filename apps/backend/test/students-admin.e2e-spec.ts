import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service';
import {
  activationToken,
  createAdmin,
  createTestApp,
  FRONTEND_ORIGIN,
  loginAdmin,
  sessionCookie,
} from './helpers';

describe('Students Admin API with PostgreSQL (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let adminCookie: string;
  let studentCookie: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    const credentials = await createAdmin(app, prisma);
    adminCookie = sessionCookie(
      await loginAdmin(app, credentials.admin.email, credentials.password),
    );
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  const post = (path: string, body?: object, cookie = adminCookie) => {
    const operation = request(app.getHttpServer())
      .post('/api/v1/admin/students' + path)
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', cookie);
    return body === undefined ? operation : operation.send(body);
  };

  it('runs the full create, search, edit, deactivate and reactivate flow', async () => {
    const marker = randomUUID().slice(0, 8);
    const created = await post('', {
      fullName: `  Martina   ${marker}  `,
    }).expect(201);
    const id = String(created.body.id);
    expect(created.body).toMatchObject({
      fullName: `Martina ${marker}`,
      isActive: true,
    });
    expect(created.body).not.toHaveProperty('subscriptions');
    expect(created.body).not.toHaveProperty('accessTokens');

    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/students')
      .query({
        status: 'active',
        search: marker.toUpperCase(),
        page: 1,
        limit: 5,
      })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).toContain(
      id,
    );
    expect(list.body.meta).toMatchObject({
      page: 1,
      limit: 5,
      total: 1,
      totalPages: 1,
    });

    await request(app.getHttpServer())
      .get('/api/v1/admin/students/' + id)
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => expect(body.fullName).toBe(`Martina ${marker}`));
    await request(app.getHttpServer())
      .patch('/api/v1/admin/students/' + id)
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', adminCookie)
      .send({ fullName: `Martina   Sol ${marker}` })
      .expect(200)
      .expect(({ body }) =>
        expect(body.fullName).toBe(`Martina Sol ${marker}`),
      );

    const activeAccess = await post('/' + id + '/access', {
      expiresInDays: 1,
    }).expect(201);
    const activeSession = sessionCookie(
      await request(app.getHttpServer())
        .post('/api/v1/auth/student/activate')
        .set('Origin', FRONTEND_ORIGIN)
        .send({ token: activationToken(activeAccess) })
        .expect(200),
    );
    const pendingAccess = await post('/' + id + '/access', {
      expiresInDays: 1,
    }).expect(201);
    const pendingToken = activationToken(pendingAccess);

    await post('/' + id + '/deactivate')
      .expect(200)
      .expect(({ body }) => {
        expect(body.isActive).toBe(false);
      });
    await post('/' + id + '/deactivate').expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/student/check')
      .set('Cookie', activeSession)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/student/activate')
      .set('Origin', FRONTEND_ORIGIN)
      .send({ token: pendingToken })
      .expect(401);
    await post('/' + id + '/access', {}).expect(409);

    const inactiveList = await request(app.getHttpServer())
      .get('/api/v1/admin/students')
      .query({ status: 'inactive', search: marker })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(inactiveList.body.items).toHaveLength(1);

    await post('/' + id + '/reactivate')
      .expect(200)
      .expect(({ body }) => {
        expect(body.isActive).toBe(true);
      });
    await post('/' + id + '/reactivate').expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/student/activate')
      .set('Origin', FRONTEND_ORIGIN)
      .send({ token: pendingToken })
      .expect(401);
    const freshAccess = await post('/' + id + '/access', {}).expect(201);
    const activated = await request(app.getHttpServer())
      .post('/api/v1/auth/student/activate')
      .set('Origin', FRONTEND_ORIGIN)
      .send({ token: activationToken(freshAccess) })
      .expect(200);
    studentCookie = sessionCookie(activated);
    await request(app.getHttpServer())
      .get('/api/v1/student/check')
      .set('Cookie', studentCookie)
      .expect(200);

    const actions = await prisma.auditLog.findMany({
      where: { entity: 'Student', entityId: id },
      select: { action: true, metadata: true },
    });
    expect(actions.map((item) => item.action).sort()).toEqual([
      'STUDENT_CREATED',
      'STUDENT_DEACTIVATED',
      'STUDENT_REACTIVATED',
      'STUDENT_UPDATED',
    ]);
    expect(JSON.stringify(actions)).not.toContain(pendingToken);
  });

  it('enforces Admin authorization for every management operation', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/students')
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/admin/students')
      .set('Origin', FRONTEND_ORIGIN)
      .send({ fullName: 'Sin sesión' })
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/students')
      .set('Cookie', studentCookie)
      .expect(403);
    await post('', { fullName: 'Intento Student' }, studentCookie).expect(403);
  });

  it('serializes activation against deactivation and never leaves an active session', async () => {
    const created = await post('', {
      fullName: 'Carrera ' + randomUUID(),
    }).expect(201);
    const access = await post('/' + created.body.id + '/access', {}).expect(
      201,
    );
    const [activation, deactivation] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/auth/student/activate')
        .set('Origin', FRONTEND_ORIGIN)
        .send({ token: activationToken(access) }),
      post('/' + created.body.id + '/deactivate'),
    ]);
    expect(deactivation.status).toBe(200);
    expect([200, 401]).toContain(activation.status);
    expect(
      await prisma.session.count({
        where: { userId: created.body.id, role: 'STUDENT', revokedAt: null },
      }),
    ).toBe(0);
    const storedAccess = await prisma.studentAccess.findUniqueOrThrow({
      where: { id: access.body.accessId },
    });
    expect(storedAccess.status).toBe(
      activation.status === 200 ? 'ACTIVATED' : 'REVOKED',
    );
    expect(
      (
        await prisma.student.findUniqueOrThrow({
          where: { id: created.body.id },
        })
      ).isActive,
    ).toBe(false);
  });

  it('rejects mass assignment, invalid names and invalid pagination', async () => {
    await post('', { fullName: 'Manipulada', isActive: false }).expect(400);
    await post('', { fullName: '   ' }).expect(400);
    await post('', { fullName: 'x'.repeat(121) }).expect(400);
    for (const query of [
      { page: 0 },
      { page: 1.5 },
      { limit: 101 },
      { status: 'deleted' },
      { search: ' ' },
      { role: 'ADMIN' },
    ]) {
      await request(app.getHttpServer())
        .get('/api/v1/admin/students')
        .query(query)
        .set('Cookie', adminCookie)
        .expect(400);
    }
    const created = await post('', {
      fullName: 'Edición segura ' + randomUUID(),
    }).expect(201);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/students/' + created.body.id)
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', adminCookie)
      .send({ fullName: 'Nuevo nombre', isActive: false })
      .expect(400);
  });

  it('validates identifiers, missing records, CSRF and empty action bodies', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/students/not-a-uuid')
      .set('Cookie', adminCookie)
      .expect(400);
    const missing = randomUUID();
    await request(app.getHttpServer())
      .get('/api/v1/admin/students/' + missing)
      .set('Cookie', adminCookie)
      .expect(404);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/students/' + missing)
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', adminCookie)
      .send({ fullName: 'No existe' })
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/v1/admin/students')
      .send({ fullName: 'Sin origen' })
      .expect(403);
    const student = await post('', {
      fullName: 'Acción segura ' + randomUUID(),
    }).expect(201);
    await post('/' + student.body.id + '/deactivate', { role: 'ADMIN' }).expect(
      400,
    );
  });

  it('publishes exact OpenAPI contracts and no delete operation', async () => {
    const schema = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const collection = schema.body.paths['/api/v1/admin/students'];
    expect(collection.get.security).toContainEqual({ session: [] });
    expect(
      collection.get.parameters
        .map((item: { name: string }) => item.name)
        .sort(),
    ).toEqual(['limit', 'page', 'search', 'status']);
    expect(
      collection.post.responses['201'].content['application/json'].schema.$ref,
    ).toBe('#/components/schemas/StudentResponseDto');
    expect(
      schema.body.paths['/api/v1/admin/students/{id}'].delete,
    ).toBeUndefined();
    expect(
      schema.body.paths['/api/v1/admin/students/{id}/deactivate'].post,
    ).toBeDefined();
    expect(
      schema.body.paths['/api/v1/admin/students/{id}/reactivate'].post,
    ).toBeDefined();
  });
});
