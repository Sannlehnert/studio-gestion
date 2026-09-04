import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service';
import { localDateToDatabaseDate } from '../src/time/business-time';
import {
  activationToken,
  createAdmin,
  createTestApp,
  FRONTEND_ORIGIN,
  loginAdmin,
  sessionCookie,
} from './helpers';

describe('Scheduling Admin API with PostgreSQL (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let adminCookie: string;

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

  const mutate = (
    method: 'post' | 'patch',
    path: string,
    body?: object,
    cookie = adminCookie,
  ) => {
    const operation = request(app.getHttpServer())
      [method]('/api/v1' + path)
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', cookie);
    return body === undefined ? operation : operation.send(body);
  };

  async function createStudent(name: string) {
    return (
      await mutate('post', '/admin/students', { fullName: name }).expect(201)
    ).body as { id: string };
  }

  async function createContract(studentId: string) {
    const plan = await mutate('post', '/admin/plans', {
      name: 'Plan scheduling ' + randomUUID(),
      classCount: 8,
      price: '30000.00',
      currency: 'ARS',
    }).expect(201);
    return mutate('post', '/admin/subscriptions', {
      studentId,
      planId: plan.body.id,
      periodStart: '2094-09-01T00:00:00-03:00',
      periodEnd: '2094-10-01T00:00:00-03:00',
    }).expect(201);
  }

  it('runs enrollment, generation, exception, cancellation and schedule-change flows', async () => {
    const student = await createStudent('Martina ' + randomUUID());
    const subscription = await createContract(student.id);
    const tuesday = await mutate('post', '/admin/schedules', {
      dayOfWeek: 2,
      startTime: '19:00',
      endTime: '21:00',
      defaultCapacity: 2,
    }).expect(201);
    const thursday = await mutate('post', '/admin/schedules', {
      dayOfWeek: 4,
      startTime: '19:00',
      endTime: '21:00',
      defaultCapacity: 2,
    }).expect(201);
    expect(tuesday.body).toMatchObject({
      startTime: '19:00',
      endTime: '21:00',
      isActive: true,
    });
    expect(tuesday.body).not.toHaveProperty('startMinute');

    const enrollment = await mutate('post', '/admin/enrollments', {
      studentId: student.id,
      subscriptionId: subscription.body.id,
      scheduleId: tuesday.body.id,
      validFrom: '2094-09-01',
      validUntil: '2094-10-01',
    }).expect(201);
    expect(enrollment.body).toMatchObject({
      operationalStatus: 'UPCOMING',
      schedule: { startTime: '19:00', endTime: '21:00' },
    });

    const generated = await mutate('post', '/admin/class-sessions/generate', {
      dateFrom: '2094-09-01',
      dateTo: '2094-09-30',
    }).expect(200);
    expect(generated.body.createdCount).toBeGreaterThan(0);
    const replay = await mutate('post', '/admin/class-sessions/generate', {
      dateFrom: '2094-09-01',
      dateTo: '2094-09-30',
    }).expect(200);
    expect(replay.body.createdCount).toBe(0);

    const session = await prisma.classSession.findUniqueOrThrow({
      where: {
        scheduleId_occurrenceDate: {
          scheduleId: tuesday.body.id,
          occurrenceDate: localDateToDatabaseDate('2094-09-07'),
        },
      },
    });
    await request(app.getHttpServer())
      .get('/api/v1/admin/class-sessions/' + session.id + '/expected-students')
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.attendanceRequired).toBe(true);
        expect(body.items).toMatchObject([
          {
            studentId: student.id,
            enrollmentId: enrollment.body.id,
            subscriptionId: subscription.body.id,
          },
        ]);
      });

    await mutate('patch', '/admin/class-sessions/' + session.id + '/capacity', {
      capacity: 3,
    })
      .expect(200)
      .expect(({ body }) => expect(body.capacity).toBe(3));
    await mutate('patch', '/admin/class-sessions/' + session.id + '/time', {
      startAt: '2094-09-07T20:00:00-03:00',
      endAt: '2094-09-07T22:00:00-03:00',
    }).expect(200);
    expect(
      (
        await prisma.schedule.findUniqueOrThrow({
          where: { id: tuesday.body.id },
        })
      ).defaultCapacity,
    ).toBe(2);

    await mutate('post', '/admin/class-sessions/' + session.id + '/cancel', {
      reason: 'Clase suspendida por mantenimiento',
    })
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('CANCELLED');
        expect(body.cancellationReason).toBe(
          'Clase suspendida por mantenimiento',
        );
      });
    await mutate('post', '/admin/class-sessions/' + session.id + '/cancel', {
      reason: 'Reintento',
    }).expect(200);

    const changed = await mutate(
      'post',
      '/admin/enrollments/' + enrollment.body.id + '/change-schedule',
      { scheduleId: thursday.body.id, effectiveDate: '2094-09-15' },
    ).expect(200);
    expect(changed.body.endedEnrollment.validUntil).toBe('2094-09-15');
    expect(changed.body.newEnrollment.validFrom).toBe('2094-09-15');

    const history = await request(app.getHttpServer())
      .get('/api/v1/admin/students/' + student.id + '/enrollments?status=all')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(history.body.items).toHaveLength(2);
  });

  it('rejects cross-entity, inactive and manipulated enrollment input', async () => {
    const first = await createStudent('Primera ' + randomUUID());
    const second = await createStudent('Segunda ' + randomUUID());
    const subscription = await createContract(first.id);
    const schedule = await mutate('post', '/admin/schedules', {
      dayOfWeek: 3,
      startTime: '10:00',
      endTime: '11:00',
      defaultCapacity: 1,
    }).expect(201);
    await mutate('post', '/admin/enrollments', {
      studentId: second.id,
      subscriptionId: subscription.body.id,
      scheduleId: schedule.body.id,
      validFrom: '2094-09-01',
      validUntil: '2094-10-01',
    }).expect(409);
    await mutate(
      'post',
      '/admin/schedules/' + schedule.body.id + '/deactivate',
    ).expect(200);
    await mutate('post', '/admin/enrollments', {
      studentId: first.id,
      subscriptionId: subscription.body.id,
      scheduleId: schedule.body.id,
      validFrom: '2094-09-01',
      validUntil: '2094-10-01',
    }).expect(409);
    await mutate('post', '/admin/enrollments', {
      studentId: first.id,
      subscriptionId: subscription.body.id,
      scheduleId: schedule.body.id,
      validFrom: '2094-09-01',
      validUntil: '2094-10-01',
      isActive: true,
      capacity: 999,
    }).expect(400);
    await mutate('post', '/admin/class-sessions/generate', {
      dateFrom: '2094-02-30',
      dateTo: '2094-03-01',
    }).expect(400);
  });

  it('keeps all scheduling routes Admin-only and CSRF protected', async () => {
    const student = await createStudent('Acceso ' + randomUUID());
    const access = await mutate(
      'post',
      '/admin/students/' + student.id + '/access',
      {},
    ).expect(201);
    const studentCookie = sessionCookie(
      await request(app.getHttpServer())
        .post('/api/v1/auth/student/activate')
        .set('Origin', FRONTEND_ORIGIN)
        .send({ token: activationToken(access) })
        .expect(200),
    );
    for (const path of [
      '/api/v1/admin/schedules',
      '/api/v1/admin/class-sessions',
      '/api/v1/admin/students/' + student.id + '/enrollments',
    ]) {
      await request(app.getHttpServer()).get(path).expect(401);
      await request(app.getHttpServer())
        .get(path)
        .set('Cookie', studentCookie)
        .expect(403);
    }
    await mutate(
      'post',
      '/admin/schedules',
      {
        dayOfWeek: 2,
        startTime: '09:00',
        endTime: '10:00',
        defaultCapacity: 2,
      },
      studentCookie,
    ).expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/admin/schedules')
      .set('Cookie', adminCookie)
      .send({
        dayOfWeek: 2,
        startTime: '09:00',
        endTime: '10:00',
        defaultCapacity: 2,
      })
      .expect(403);
  });
});
