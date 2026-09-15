import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service';
import { AttendanceService } from '../src/attendance/attendance.service';
import {
  activationToken,
  createAdmin,
  createTestApp,
  FRONTEND_ORIGIN,
  loginAdmin,
  sessionCookie,
} from './helpers';
import { QrClock } from './qr-fixture';

describe('Recoveries complete HTTP flows and authorization (e2e)', () => {
  const clock = new QrClock();
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let cookie: string;
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
    const admin = await createAdmin(app, prisma);
    cookie = sessionCookie(
      await loginAdmin(app, admin.admin.email, admin.password),
    );
  });
  beforeEach(() => clock.set(new Date('2035-01-09T13:00:00Z')));
  afterAll(async () => {
    if (app) await app.close();
  });
  const post = (path: string, body: object = {}, auth = cookie) =>
    request(app.getHttpServer())
      .post('/api/v1' + path)
      .set('Cookie', auth)
      .set('Origin', FRONTEND_ORIGIN)
      .send(body);
  const get = (path: string, auth = cookie) =>
    request(app.getHttpServer())
      .get('/api/v1' + path)
      .set('Cookie', auth);
  async function fixture() {
    clock.set(new Date('2035-01-09T13:00:00Z'));
    const student = (
      await post('/admin/students', {
        fullName: 'Recovery HTTP ' + randomUUID(),
      }).expect(201)
    ).body;
    const plan = (
      await post('/admin/plans', {
        name: 'Plan 8 ' + randomUUID(),
        classCount: 8,
        price: '200.00',
        currency: 'ARS',
      }).expect(201)
    ).body;
    const subscription = (
      await post('/admin/subscriptions', {
        studentId: student.id,
        planId: plan.id,
        periodStart: '2035-01-09T00:00:00Z',
        periodEnd: '2035-02-01T00:00:00Z',
      }).expect(201)
    ).body;
    const schedule = (
      await post('/admin/schedules', {
        dayOfWeek: 3,
        startTime: '10:00',
        endTime: '11:00',
        defaultCapacity: 20,
      }).expect(201)
    ).body;
    const targetSchedule = (
      await post('/admin/schedules', {
        dayOfWeek: 4,
        startTime: '10:00',
        endTime: '11:00',
        defaultCapacity: 20,
      }).expect(201)
    ).body;
    await post('/admin/enrollments', {
      studentId: student.id,
      subscriptionId: subscription.id,
      scheduleId: schedule.id,
      validFrom: '2035-01-10',
      validUntil: '2035-02-01',
    }).expect(201);
    await post('/admin/class-sessions/generate', {
      dateFrom: '2035-01-10',
      dateTo: '2035-01-11',
    }).expect(200);
    const originalClass = await prisma.classSession.findUniqueOrThrow({
      where: {
        scheduleId_occurrenceDate: {
          scheduleId: schedule.id,
          occurrenceDate: new Date('2035-01-10T00:00:00Z'),
        },
      },
    });
    const target = await prisma.classSession.findUniqueOrThrow({
      where: {
        scheduleId_occurrenceDate: {
          scheduleId: targetSchedule.id,
          occurrenceDate: new Date('2035-01-11T00:00:00Z'),
        },
      },
    });
    clock.set(new Date('2035-01-10T15:00:00Z'));
    await app.get(AttendanceService).reconcileDue();
    const absence = await prisma.attendance.findUniqueOrThrow({
      where: {
        studentId_classSessionId: {
          studentId: student.id,
          classSessionId: originalClass.id,
        },
      },
    });
    expect(absence.status).toBe('ABSENT');
    const access = await post(`/admin/students/${student.id}/access`, {
      expiresInDays: 1,
    }).expect(201);
    const studentCookie = sessionCookie(
      await post(
        '/auth/student/activate',
        { token: activationToken(access) },
        '',
      ).expect(200),
    );
    return { student, subscription, target, absence, studentCookie };
  }
  const authorize = (f: Awaited<ReturnType<typeof fixture>>) =>
    post(`/admin/attendances/${f.absence.id}/recovery`, {
      targetClassSessionId: f.target.id,
    });
  it('Admin → Student → Plan8 → Subscription → Enrollment → ABSENT → Recovery → upcoming → QR → PRESENT consumes only the original', async () => {
    const f = await fixture(),
      r = (await authorize(f).expect(200)).body;
    expect((await authorize(f).expect(200)).body.id).toBe(r.id);
    const upcoming = await get(
      '/student/class-sessions/upcoming',
      f.studentCookie,
    ).expect(200);
    expect(upcoming.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          origin: 'RECOVERY',
          recoveryId: r.id,
          classSession: expect.objectContaining({ id: f.target.id }),
        }),
      ]),
    );
    expect(
      await prisma.enrollment.count({
        where: { studentId: f.student.id, scheduleId: f.target.scheduleId },
      }),
    ).toBe(0);
    clock.set(f.target.startAt);
    const qr = (
      await post(`/admin/class-sessions/${f.target.id}/qr-challenge`).expect(
        201,
      )
    ).body;
    const path = `/student/class-sessions/${f.target.id}/attendance`;
    await post(path, {}, f.studentCookie).expect(400);
    const result = (
      await post(path, { challenge: qr.challenge }, f.studentCookie).expect(200)
    ).body;
    expect(result).toMatchObject({
      origin: 'RECOVERY',
      recoveryId: r.id,
      attendance: { status: 'PRESENT', consumesAllowance: false },
      classSummary: { classAllowance: 8, usedClasses: 1, remainingClasses: 7 },
    });
    expect(
      (
        await post(path, { challenge: qr.challenge }, f.studentCookie).expect(
          200,
        )
      ).body.attendance.id,
    ).toBe(result.attendance.id);
    expect(
      (await get(`/student/recoveries/${r.id}`, f.studentCookie).expect(200))
        .body.state,
    ).toBe('COMPLETED');
    expect(
      await prisma.attendance.findUnique({ where: { id: f.absence.id } }),
    ).toEqual(f.absence);
    const trace = await prisma.auditLog.findMany({ where: { entityId: r.id } });
    expect(trace).toHaveLength(1);
    expect(JSON.stringify(trace)).not.toContain(qr.challenge);
  });
  it('missed Recovery closes once, preserves original consumption and is not recoverable again', async () => {
    const f = await fixture(),
      r = (await authorize(f).expect(200)).body;
    clock.set(new Date('2035-01-11T15:00:00Z'));
    await app.get(AttendanceService).reconcileDue();
    await app.get(AttendanceService).reconcileDue();
    const result = (
      await get(`/student/recoveries/${r.id}`, f.studentCookie).expect(200)
    ).body;
    expect(result).toMatchObject({
      state: 'MISSED',
      attendance: { status: 'ABSENT' },
    });
    expect(
      (
        await get(
          `/student/subscriptions/${f.subscription.id}/class-summary`,
          f.studentCookie,
        ).expect(200)
      ).body,
    ).toMatchObject({ usedClasses: 1, remainingClasses: 7 });
    await post(`/admin/attendances/${result.attendance.id}/recovery`, {
      targetClassSessionId: f.target.id,
    }).expect(409);
  });
  it('enforces roles, ownership, CSRF, strict input and bounded filters with safe OpenAPI', async () => {
    const f = await fixture(),
      r = (await authorize(f).expect(200)).body;
    const other = await fixture();
    const path = `/admin/attendances/${f.absence.id}/recovery`;
    await request(app.getHttpServer())
      .post('/api/v1' + path)
      .set('Origin', FRONTEND_ORIGIN)
      .send({ targetClassSessionId: f.target.id })
      .expect(401);
    await post(
      path,
      { targetClassSessionId: f.target.id },
      f.studentCookie,
    ).expect(403);
    await request(app.getHttpServer())
      .post('/api/v1' + path)
      .set('Cookie', cookie)
      .send({ targetClassSessionId: f.target.id })
      .expect(403);
    for (const extra of [
      { studentId: other.student.id },
      { subscriptionId: other.subscription.id },
      { authorizedByAdminId: randomUUID() },
      { status: 'COMPLETED' },
      { consumesAllowance: false },
      { recoveryId: r.id },
    ])
      await post(path, { targetClassSessionId: f.target.id, ...extra }).expect(
        400,
      );
    await post(path, { targetClassSessionId: 'invalid' }).expect(400);
    await post(`/admin/recoveries/${r.id}/cancel`, { reason: 'x' }).expect(400);
    await post(`/admin/recoveries/${r.id}/cancel`, {
      reason: 'Motivo',
      cancelledAt: new Date().toISOString(),
    }).expect(400);
    await get(`/student/recoveries/${r.id}`, other.studentCookie).expect(404);
    await get(
      '/student/recoveries?studentId=' + f.student.id,
      other.studentCookie,
    ).expect(400);
    await get('/student/recoveries?limit=101', f.studentCookie).expect(400);
    const own = (
      await get('/student/recoveries?limit=1', f.studentCookie).expect(200)
    ).body;
    expect(own.items).toHaveLength(1);
    expect(own.items[0].studentId).toBe(f.student.id);
    const filtered = (
      await get(
        `/admin/recoveries?studentId=${f.student.id}&originalAttendanceId=${f.absence.id}&limit=1`,
      ).expect(200)
    ).body;
    expect(filtered.meta.total).toBe(1);
    for (const field of [
      'authorizedByAdminId',
      'tokenHash',
      'passwordHash',
      'sessions',
    ])
      expect(JSON.stringify(own)).not.toContain(field);
    const cancelled = (
      await post(`/admin/recoveries/${r.id}/cancel`, {
        reason: 'Cambio de fecha',
      }).expect(200)
    ).body;
    expect(cancelled.state).toBe('CANCELLED');
    expect(
      (
        await post(`/admin/recoveries/${r.id}/cancel`, {
          reason: 'Reintento',
        }).expect(200)
      ).body.cancelledAt,
    ).toBe(cancelled.cancelledAt);
    expect(
      (
        await get(
          '/student/recoveries?cancellation=not_cancelled',
          f.studentCookie,
        ).expect(200)
      ).body.meta.total,
    ).toBe(0);
    const spec = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    expect(
      spec.paths['/api/v1/admin/attendances/{attendanceId}/recovery'].post,
    ).toBeDefined();
    expect(
      spec.components.schemas.AuthorizeRecoveryDto.properties,
    ).toHaveProperty('targetClassSessionId');
    expect(
      spec.components.schemas.RecoveryResponseDto.properties,
    ).toHaveProperty('state');
  });
  it('HTTP rejects out-of-period targets, full classes and cancelled classes', async () => {
    const f = await fixture(),
      g = await fixture();
    const outside = await prisma.classSession.create({
      data: {
        scheduleId: f.target.scheduleId,
        occurrenceDate: new Date('2035-02-01T00:00:00Z'),
        startAt: new Date('2035-02-01T13:00:00Z'),
        endAt: new Date('2035-02-01T14:00:00Z'),
        capacity: 20,
      },
    });
    await post('/admin/attendances/' + f.absence.id + '/recovery', {
      targetClassSessionId: outside.id,
    }).expect(409);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/class-sessions/' + f.target.id + '/capacity')
      .set('Cookie', cookie)
      .set('Origin', FRONTEND_ORIGIN)
      .send({ capacity: 1 })
      .expect(200);
    await post('/admin/enrollments', {
      studentId: g.student.id,
      subscriptionId: g.subscription.id,
      scheduleId: f.target.scheduleId,
      validFrom: '2035-01-11',
      validUntil: '2035-02-01',
    }).expect(201);
    await authorize(f).expect(409);
    await post('/admin/class-sessions/' + f.target.id + '/cancel', {
      reason: 'Clase cancelada',
    }).expect(200);
    await authorize(f).expect(409);
    expect(
      await prisma.recovery.count({
        where: { originalAbsenceId: f.absence.id },
      }),
    ).toBe(0);
  });
  it('cancelled Recovery cannot PRESENT even with valid shared QR and Student cannot cancel it', async () => {
    const f = await fixture(),
      r = (await authorize(f).expect(200)).body;
    await post(
      '/admin/recoveries/' + r.id + '/cancel',
      { reason: 'Cancelación no autorizada' },
      f.studentCookie,
    ).expect(403);
    await post('/admin/recoveries/' + r.id + '/cancel', {
      reason: 'Cambio administrativo',
    }).expect(200);
    clock.set(f.target.startAt);
    const qr = (
      await post(
        '/admin/class-sessions/' + f.target.id + '/qr-challenge',
      ).expect(201)
    ).body;
    await post(
      '/student/class-sessions/' + f.target.id + '/attendance',
      { challenge: qr.challenge },
      f.studentCookie,
    ).expect(404);
    expect(await prisma.attendance.count({ where: { recoveryId: r.id } })).toBe(
      0,
    );
  });
});
