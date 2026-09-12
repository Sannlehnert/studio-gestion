import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AttendanceStatus, Prisma } from '@prisma/client';
import request from 'supertest';
import { AttendanceService } from '../src/attendance/attendance.service';
import { PrismaService } from '../src/prisma.service';
import { StudentsService } from '../src/students/students.service';
import { BusinessTimeService } from '../src/time/business-time.service';
import {
  addLocalDays,
  isoDayOfWeek,
  localDateToDatabaseDate,
  localTimeForInstant,
  minuteToTime,
} from '../src/time/business-time';
import {
  activationToken,
  createAdmin,
  createTestApp,
  FRONTEND_ORIGIN,
  loginAdmin,
  sessionCookie,
} from './helpers';

describe('Attendance API with PostgreSQL (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let attendance: AttendanceService;
  let businessTime: BusinessTimeService;
  let students: StudentsService;
  let adminCookie: string;
  let adminId: string;
  const challenges = new Map<string, string>();
  async function issue(id: string) {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/class-sessions/${id}/qr-challenge`)
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);
    challenges.set(id, response.body.challenge);
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    attendance = app.get(AttendanceService);
    businessTime = app.get(BusinessTimeService);
    students = app.get(StudentsService);
    const credentials = await createAdmin(app, prisma);
    adminId = credentials.admin.id;
    adminCookie = sessionCookie(
      await loginAdmin(app, credentials.admin.email, credentials.password),
    );
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function fixture(options?: { past?: boolean; allowance?: number }) {
    const now = new Date();
    const today = businessTime.today();
    const student = await prisma.student.create({
      data: {
        fullName: 'API attendance ' + randomUUID(),
        createdAt: new Date(now.getTime() - 14 * 86_400_000),
      },
    });
    const plan = await prisma.plan.create({
      data: {
        name: 'Plan API ' + randomUUID(),
        classCount: options?.allowance ?? 4,
        price: new Prisma.Decimal('200.00'),
        currency: 'ARS',
      },
    });
    const subscription = await prisma.subscription.create({
      data: {
        studentId: student.id,
        planId: plan.id,
        planName: plan.name,
        classAllowance: plan.classCount,
        agreedPrice: plan.price,
        currency: 'ARS',
        periodStart: new Date(now.getTime() - 7 * 86_400_000),
        periodEnd: new Date(now.getTime() + 7 * 86_400_000),
      },
    });
    const schedule = await prisma.schedule.create({
      data: {
        dayOfWeek: isoDayOfWeek(today),
        startMinute: 600,
        endMinute: 660,
        defaultCapacity: 10,
      },
    });
    await prisma.enrollment.create({
      data: {
        studentId: student.id,
        subscriptionId: subscription.id,
        scheduleId: schedule.id,
        validFrom: localDateToDatabaseDate(addLocalDays(today, -1)),
        validUntil: localDateToDatabaseDate(addLocalDays(today, 2)),
      },
    });
    const classSession = await prisma.classSession.create({
      data: {
        scheduleId: schedule.id,
        occurrenceDate: localDateToDatabaseDate(today),
        startAt: new Date(now.getTime() - (options?.past ? 180 : 5) * 60_000),
        endAt: new Date(now.getTime() - (options?.past ? 120 : -5) * 60_000),
        capacity: 10,
      },
    });
    if (!options?.past) await issue(classSession.id);
    return { student, subscription, classSession };
  }

  async function fullAdminFlowFixture() {
    const now = new Date();
    const today = businessTime.today(now);
    const local = localTimeForInstant(now, businessTime.timeZone);
    const startMinute = Math.min(local.hour * 60 + local.minute, 1438);
    const post = (path: string, body: object) =>
      request(app.getHttpServer())
        .post('/api/v1' + path)
        .set('Origin', FRONTEND_ORIGIN)
        .set('Cookie', adminCookie)
        .send(body);
    const student = await post('/admin/students', {
      fullName: 'Flujo completo ' + randomUUID(),
    }).expect(201);
    const plan = await post('/admin/plans', {
      name: 'Plan 8 ' + randomUUID(),
      classCount: 8,
      price: '200.00',
      currency: 'ARS',
    }).expect(201);
    const subscription = await post('/admin/subscriptions', {
      studentId: student.body.id,
      planId: plan.body.id,
      periodStart: new Date(now.getTime() - 86_400_000).toISOString(),
      periodEnd: new Date(now.getTime() + 86_400_000).toISOString(),
    }).expect(201);
    const schedule = await post('/admin/schedules', {
      dayOfWeek: isoDayOfWeek(today),
      startTime: minuteToTime(startMinute),
      endTime: minuteToTime(startMinute + 1),
      defaultCapacity: 10,
    }).expect(201);
    await post('/admin/enrollments', {
      studentId: student.body.id,
      subscriptionId: subscription.body.id,
      scheduleId: schedule.body.id,
      validFrom: today,
      validUntil: addLocalDays(today, 1),
    }).expect(201);
    await post('/admin/class-sessions/generate', {
      dateFrom: today,
      dateTo: today,
    }).expect(200);
    const generatedClassSession = await prisma.classSession.findUniqueOrThrow({
      where: {
        scheduleId_occurrenceDate: {
          scheduleId: schedule.body.id,
          occurrenceDate: localDateToDatabaseDate(today),
        },
      },
    });
    const classSession = await prisma.classSession.update({
      where: { id: generatedClassSession.id },
      data: {
        startAt: new Date(now.getTime() + 5 * 60_000),
        endAt: new Date(now.getTime() + 10 * 60_000),
      },
    });
    await issue(classSession.id);
    return {
      student: student.body as { id: string },
      subscription: subscription.body as { id: string },
      classSession,
    };
  }

  async function addOpenSession(fixture: {
    student: { id: string };
    subscription: { id: string };
  }) {
    const now = new Date();
    const today = businessTime.today(now);
    const schedule = await prisma.schedule.create({
      data: {
        dayOfWeek: isoDayOfWeek(today),
        startMinute: 720,
        endMinute: 780,
        defaultCapacity: 10,
      },
    });
    await prisma.enrollment.create({
      data: {
        studentId: fixture.student.id,
        subscriptionId: fixture.subscription.id,
        scheduleId: schedule.id,
        validFrom: localDateToDatabaseDate(addLocalDays(today, -1)),
        validUntil: localDateToDatabaseDate(addLocalDays(today, 2)),
      },
    });
    const session = await prisma.classSession.create({
      data: {
        scheduleId: schedule.id,
        occurrenceDate: localDateToDatabaseDate(today),
        startAt: new Date(now.getTime() - 5 * 60_000),
        endAt: new Date(now.getTime() + 5 * 60_000),
        capacity: 10,
      },
    });
    await issue(session.id);
    return session;
  }

  async function studentCookie(studentId: string) {
    const issued = await request(app.getHttpServer())
      .post('/api/v1/admin/students/' + studentId + '/access')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', adminCookie)
      .send({ expiresInDays: 1 })
      .expect(201);
    const activated = await request(app.getHttpServer())
      .post('/api/v1/auth/student/activate')
      .set('Origin', FRONTEND_ORIGIN)
      .send({ token: activationToken(issued) })
      .expect(200);
    return sessionCookie(activated);
  }

  it('completes the student PRESENT flow and admin read model without trusting request identity', async () => {
    const own = await fullAdminFlowFixture();
    const foreign = await fixture();
    const ownCookie = await studentCookie(own.student.id);
    const foreignCookie = await studentCookie(foreign.student.id);

    await request(app.getHttpServer())
      .get('/api/v1/student/class-sessions/upcoming')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/student/class-sessions/upcoming')
      .set('Cookie', adminCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(
        '/api/v1/admin/class-sessions/' + own.classSession.id + '/attendance',
      )
      .set('Cookie', ownCookie)
      .expect(403);

    const upcoming = await request(app.getHttpServer())
      .get('/api/v1/student/class-sessions/upcoming?limit=10')
      .set('Cookie', ownCookie)
      .expect(200);
    expect(upcoming.body.items).toMatchObject([
      {
        classSession: { id: own.classSession.id },
        window: { status: 'OPEN' },
        attendance: null,
        classSummary: {
          subscriptionId: own.subscription.id,
          usedClasses: 0,
          remainingClasses: 8,
        },
      },
    ]);
    expect(JSON.stringify(upcoming.body)).not.toContain(foreign.student.id);

    await request(app.getHttpServer())
      .post(
        '/api/v1/student/class-sessions/' + own.classSession.id + '/attendance',
      )
      .set('Cookie', ownCookie)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post(
        '/api/v1/student/class-sessions/' + own.classSession.id + '/attendance',
      )
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', ownCookie)
      .send({ studentId: foreign.student.id, status: 'ABSENT' })
      .expect(400);

    const recorded = await request(app.getHttpServer())
      .post(
        '/api/v1/student/class-sessions/' + own.classSession.id + '/attendance',
      )
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', ownCookie)
      .send({ challenge: challenges.get(own.classSession.id) })
      .expect(200);
    expect(recorded.body.attendance).toMatchObject({
      studentId: own.student.id,
      subscriptionId: own.subscription.id,
      classSessionId: own.classSession.id,
      status: AttendanceStatus.PRESENT,
      source: 'STUDENT',
    });
    expect(recorded.body.attendance).not.toHaveProperty('note');

    const replay = await request(app.getHttpServer())
      .post(
        '/api/v1/student/class-sessions/' + own.classSession.id + '/attendance',
      )
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', ownCookie)
      .send({ challenge: challenges.get(own.classSession.id) })
      .expect(200);
    expect(replay.body.attendance.id).toBe(recorded.body.attendance.id);

    await request(app.getHttpServer())
      .get(
        '/api/v1/student/class-sessions/' + own.classSession.id + '/attendance',
      )
      .set('Cookie', ownCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.attendance.id).toBe(recorded.body.attendance.id);
      });
    await request(app.getHttpServer())
      .get(
        '/api/v1/student/class-sessions/' + own.classSession.id + '/attendance',
      )
      .set('Cookie', foreignCookie)
      .expect(404);
    await request(app.getHttpServer())
      .get(
        '/api/v1/student/subscriptions/' +
          foreign.subscription.id +
          '/class-summary',
      )
      .set('Cookie', ownCookie)
      .expect(404);

    await request(app.getHttpServer())
      .get(
        '/api/v1/admin/class-sessions/' + own.classSession.id + '/attendance',
      )
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.totals).toMatchObject({
          expected: 1,
          present: 1,
          absent: 0,
          pending: 0,
        });
        expect(body.items[0]).toMatchObject({
          studentId: own.student.id,
          state: 'PRESENT',
        });
      });
    await request(app.getHttpServer())
      .get(
        '/api/v1/admin/subscriptions/' + own.subscription.id + '/class-summary',
      )
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ usedClasses: 1, remainingClasses: 7 });
      });
  });

  it('shows SYSTEM absence after downtime reconciliation', async () => {
    const missed = await fixture({ past: true });
    const cookie = await studentCookie(missed.student.id);
    await attendance.reconcileDue(new Date());

    await request(app.getHttpServer())
      .get(
        '/api/v1/student/class-sessions/' +
          missed.classSession.id +
          '/attendance',
      )
      .set('Cookie', cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.attendance).toMatchObject({
          status: 'ABSENT',
          source: 'SYSTEM',
        });
        expect(body.classSummary).toMatchObject({
          usedClasses: 1,
          remainingClasses: 3,
        });
      });
    await request(app.getHttpServer())
      .get(
        '/api/v1/admin/class-sessions/' +
          missed.classSession.id +
          '/attendance',
      )
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.totals).toMatchObject({ absent: 1, unresolved: 0 });
        expect(body.items[0].state).toBe('ABSENT');
      });
  });

  it('validates UUIDs and query bounds consistently', async () => {
    const own = await fixture();
    const cookie = await studentCookie(own.student.id);
    await request(app.getHttpServer())
      .get('/api/v1/student/class-sessions/upcoming?limit=0')
      .set('Cookie', cookie)
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/student/class-sessions/not-a-uuid/attendance')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', cookie)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/admin/class-sessions/not-a-uuid/attendance')
      .set('Cookie', adminCookie)
      .expect(400);
  });

  it('rejects before/after window, cancelled, inactive, invalid subscription and exhausted allowance', async () => {
    const postAttendance = (classSessionId: string, cookie: string) =>
      request(app.getHttpServer())
        .post(
          '/api/v1/student/class-sessions/' + classSessionId + '/attendance',
        )
        .set('Origin', FRONTEND_ORIGIN)
        .set('Cookie', cookie)
        .send({ challenge: challenges.get(classSessionId) });
    const now = new Date();

    const before = await fixture();
    const beforeCookie = await studentCookie(before.student.id);
    await prisma.classSession.update({
      where: { id: before.classSession.id },
      data: {
        startAt: new Date(now.getTime() + 2 * 60 * 60_000),
        endAt: new Date(now.getTime() + 3 * 60 * 60_000),
      },
    });
    await postAttendance(before.classSession.id, beforeCookie).expect(409);

    const after = await fixture();
    const afterCookie = await studentCookie(after.student.id);
    await prisma.classSession.update({
      where: { id: after.classSession.id },
      data: {
        startAt: new Date(now.getTime() - 3 * 60 * 60_000),
        endAt: new Date(now.getTime() - 2 * 60 * 60_000),
      },
    });
    await postAttendance(after.classSession.id, afterCookie).expect(409);

    const cancelled = await fixture();
    const cancelledCookie = await studentCookie(cancelled.student.id);
    await prisma.classSession.update({
      where: { id: cancelled.classSession.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledByAdminId: adminId,
        cancellationReason: 'Cancelada para validar Attendance',
      },
    });
    await postAttendance(cancelled.classSession.id, cancelledCookie).expect(
      409,
    );
    await request(app.getHttpServer())
      .get(
        '/api/v1/student/subscriptions/' +
          cancelled.subscription.id +
          '/class-summary',
      )
      .set('Cookie', cancelledCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ usedClasses: 0, remainingClasses: 4 });
      });

    const inactive = await fixture();
    const inactiveCookie = await studentCookie(inactive.student.id);
    await students.deactivate(inactive.student.id, adminId);
    await postAttendance(inactive.classSession.id, inactiveCookie).expect(401);

    const cancelledSubscription = await fixture();
    const cancelledSubscriptionCookie = await studentCookie(
      cancelledSubscription.student.id,
    );
    await prisma.subscription.update({
      where: { id: cancelledSubscription.subscription.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(now.getTime() - 30 * 60_000),
      },
    });
    await postAttendance(
      cancelledSubscription.classSession.id,
      cancelledSubscriptionCookie,
    ).expect(404);

    const expired = await fixture();
    const expiredCookie = await studentCookie(expired.student.id);
    await prisma.subscription.update({
      where: { id: expired.subscription.id },
      data: { periodEnd: new Date(now.getTime() - 60 * 60_000) },
    });
    await postAttendance(expired.classSession.id, expiredCookie).expect(404);

    const exhausted = await fixture({ allowance: 1 });
    const exhaustedCookie = await studentCookie(exhausted.student.id);
    await postAttendance(exhausted.classSession.id, exhaustedCookie).expect(
      200,
    );
    const additional = await addOpenSession(exhausted);
    await postAttendance(additional.id, exhaustedCookie).expect(409);
    expect(
      await prisma.attendance.count({
        where: { subscriptionId: exhausted.subscription.id },
      }),
    ).toBe(1);
  });
});
