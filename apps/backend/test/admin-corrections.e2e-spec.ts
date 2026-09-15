import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service';
import {
  createTestApp,
  createAdmin,
  loginAdmin,
  sessionCookie,
  FRONTEND_ORIGIN,
  activationToken,
} from './helpers';
import { qrFixture, QrClock, QR_NOW } from './qr-fixture';

describe('Admin corrections and audit HTTP contracts', () => {
  const clock = new QrClock();
  let app: NestExpressApplication,
    prisma: PrismaService,
    cookie: string,
    adminId: string;
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
    const admin = await createAdmin(app, prisma);
    adminId = admin.admin.id;
    cookie = sessionCookie(
      await loginAdmin(app, admin.admin.email, admin.password),
    );
  });
  beforeEach(() => clock.set(QR_NOW));
  afterAll(async () => {
    if (app) await app.close();
  });
  const post = (path: string, body: object, auth = cookie) =>
    request(app.getHttpServer())
      .post('/api/v1' + path)
      .set('Cookie', auth)
      .set('Origin', FRONTEND_ORIGIN)
      .send(body);
  const get = (path: string, auth = cookie) =>
    request(app.getHttpServer())
      .get('/api/v1' + path)
      .set('Cookie', auth);
  const manualPath = (f: Awaited<ReturnType<typeof qrFixture>>) =>
    `/admin/class-sessions/${f.session.id}/students/${f.student.id}/attendance`;
  it('manual PRESENT → correction → no-op → paginated history → filtered audit', async () => {
    const f = await qrFixture(prisma);
    const created = await post(manualPath(f), {
      reason: '  Teléfono sin batería  ',
    }).expect(201);
    const id = created.body.attendance.id;
    expect(created.body.attendance).toMatchObject({
      status: 'PRESENT',
      originalStatus: 'PRESENT',
      source: 'ADMIN',
    });
    await post(manualPath(f), { reason: 'Reintento manual' }).expect(409);
    const path = `/admin/attendances/${id}/corrections`;
    const changed = await post(path, {
      targetStatus: 'ABSENT',
      reason: 'Alumna identificada incorrectamente',
    }).expect(200);
    expect(changed.body.correction).toMatchObject({
      correctedByAdminId: adminId,
      sequence: 1,
      previousStatus: 'PRESENT',
      targetStatus: 'ABSENT',
    });
    expect(changed.body.attendance).toMatchObject({
      source: 'ADMIN',
      originalStatus: 'PRESENT',
      consumesAllowance: true,
    });
    expect(
      (
        await post(path, {
          targetStatus: 'ABSENT',
          reason: 'Mismo resultado',
        }).expect(200)
      ).body.correction,
    ).toBeNull();
    expect(
      (await get(path + '?page=1&limit=1').expect(200)).body.meta,
    ).toMatchObject({ total: 1, totalPages: 1 });
    const audit = await get(
      `/admin/audit-logs?entityType=Attendance&entityId=${id}&actorType=ADMIN&actorId=${adminId}&action=ATTENDANCE_CORRECTED&dateFrom=2035-01-01T00:00:00Z&dateTo=2036-01-01T00:00:00Z`,
    ).expect(200);
    expect(audit.body.items).toHaveLength(1);
    expect(audit.body.items[0].metadata).toMatchObject({
      correctionId: changed.body.correction.id,
      sequence: 1,
    });
    expect(
      (
        await get(
          `/admin/subscriptions/${f.subscription.id}/class-summary`,
        ).expect(200)
      ).body.usedClasses,
    ).toBe(1);
  });
  it('rejects unauthenticated, Student, CSRF and foreign IDs without mutations', async () => {
    const f = await qrFixture(prisma),
      access = await post(`/admin/students/${f.student.id}/access`, {
        expiresInDays: 1,
      }).expect(201);
    const studentCookie = sessionCookie(
      await post(
        '/auth/student/activate',
        { token: activationToken(access) },
        '',
      ).expect(200),
    );
    for (const auth of ['', studentCookie]) {
      const status = auth ? 403 : 401;
      await post(manualPath(f), { reason: 'Motivo válido' }, auth).expect(
        status,
      );
      await post(
        `/admin/attendances/${randomUUID()}/corrections`,
        { targetStatus: 'ABSENT', reason: 'Motivo válido' },
        auth,
      ).expect(status);
      await get('/admin/audit-logs', auth).expect(status);
      await get(`/admin/attendances/${randomUUID()}/corrections`, auth).expect(
        status,
      );
    }
    await request(app.getHttpServer())
      .post('/api/v1' + manualPath(f))
      .set('Cookie', cookie)
      .set('Origin', 'https://foreign.test')
      .send({ reason: 'Motivo válido' })
      .expect(403);
    await post(`/admin/attendances/${randomUUID()}/corrections`, {
      targetStatus: 'PRESENT',
      reason: 'Motivo válido',
    }).expect(404);
    await post(
      `/admin/class-sessions/${f.session.id}/students/${randomUUID()}/attendance`,
      { reason: 'Motivo válido' },
    ).expect(409);
    expect(
      await prisma.attendance.count({ where: { studentId: f.student.id } }),
    ).toBe(0);
  });
  it('strict bodies reject mass assignment and malformed filters', async () => {
    const f = await qrFixture(prisma);
    for (const field of [
      'status',
      'source',
      'subscriptionId',
      'recoveryId',
      'recordedAt',
      'consumption',
      'createdByAdminId',
    ])
      await post(manualPath(f), {
        reason: 'Motivo válido',
        [field]: 'manipulado',
      }).expect(400);
    for (const reason of ['', ' ', 'ab', 'a'.repeat(501), null, 42])
      await post(manualPath(f), { reason }).expect(400);
    const id = (
      await post(manualPath(f), { reason: 'Motivo válido' }).expect(201)
    ).body.attendance.id;
    await post(`/admin/attendances/${id}/corrections`, {
      targetStatus: 'PRESENT',
      reason: 'Motivo válido',
      studentId: randomUUID(),
    }).expect(400);
    await post(`/admin/attendances/${id}/corrections`, {
      targetStatus: 'UNKNOWN',
      reason: 'Motivo válido',
    }).expect(400);
    for (const query of [
      'limit=101',
      'page=0',
      'actorType=ROOT',
      'actorId=invalid',
      'unknown=x',
      'dateFrom=bad',
      'dateFrom=2035-01-01',
      'dateFrom=2036-01-01T00:00:00Z&dateTo=2035-01-01T00:00:00Z',
    ])
      await get('/admin/audit-logs?' + query).expect(400);
    await get('/admin/audit-logs?action=%27%20OR%201%3D1--')
      .expect(200)
      .expect((r) => expect(r.body.items).toEqual([]));
  });
  it('audit metadata is allowlisted, ordered and read-only; GET does not audit', async () => {
    const entityId = randomUUID(),
      at = new Date('2035-01-01');
    const first = await prisma.auditLog.create({
      data: {
        actorType: 'ADMIN',
        actorId: adminId,
        action: 'ATTENDANCE_CHALLENGE_ISSUED',
        entity: 'AttendanceChallenge',
        entityId,
        createdAt: at,
        metadata: {
          classSessionId: randomUUID(),
          tokenHash: 'sensitive',
          challenge: 'sensitive',
          malicious: { password: 'sensitive' },
        },
      },
    });
    const second = await prisma.auditLog.create({
      data: {
        actorType: 'SYSTEM',
        actorId: null,
        action: 'UNKNOWN_EVENT',
        entity: 'AttendanceChallenge',
        entityId,
        createdAt: at,
        metadata: { password: 'sensitive' },
      },
    });
    const before = await prisma.auditLog.count();
    const response = await get(`/admin/audit-logs?entityId=${entityId}`).expect(
      200,
    );
    expect(response.body.items.map((r: { id: string }) => r.id)).toEqual(
      [first.id, second.id].sort().reverse(),
    );
    expect(JSON.stringify(response.body)).not.toContain('sensitive');
    expect(
      response.body.items.find((r: { id: string }) => r.id === second.id)
        .metadata,
    ).toEqual({});
    expect(await prisma.auditLog.count()).toBe(before);
    await request(app.getHttpServer())
      .delete(`/api/v1/admin/audit-logs/${first.id}`)
      .set('Cookie', cookie)
      .set('Origin', FRONTEND_ORIGIN)
      .expect(404);
  });
  it('OpenAPI exposes bounded DTOs and ADMIN source without token examples', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(response.body.paths['/api/v1/admin/audit-logs'].get).toBeDefined();
    expect(
      response.body.paths[
        '/api/v1/admin/attendances/{attendanceId}/corrections'
      ].post,
    ).toBeDefined();
    expect(
      response.body.components.schemas.ManualAttendanceDto.required,
    ).toEqual(['reason']);
    expect(
      response.body.components.schemas.AttendanceResponseDto.properties.source
        .enum,
    ).toContain('ADMIN');
  });
});
