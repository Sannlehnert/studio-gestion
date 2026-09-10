import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AttendanceService } from '../src/attendance/attendance.service';
import { PrismaService } from '../src/prisma.service';
import {
  addLocalDays,
  isoDayOfWeek,
  localDateToDatabaseDate,
} from '../src/time/business-time';
import { BusinessTimeService } from '../src/time/business-time.service';
import { Clock } from '../src/time/clock';
import {
  createAdmin,
  createTestApp,
  FRONTEND_ORIGIN,
  loginAdmin,
  sessionCookie,
} from './helpers';

class MutableClock implements Clock {
  constructor(private current: Date) {}

  now() {
    return new Date(this.current);
  }

  set(instant: Date) {
    this.current = new Date(instant);
  }
}

describe('Historical eligibility through Admin APIs (e2e)', () => {
  const clock = new MutableClock(new Date());
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let attendance: AttendanceService;
  let businessTime: BusinessTimeService;
  let adminCookie: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
    attendance = app.get(AttendanceService);
    businessTime = app.get(BusinessTimeService);
    const credentials = await createAdmin(app, prisma);
    adminCookie = sessionCookie(
      await loginAdmin(app, credentials.admin.email, credentials.password),
    );
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('keeps a generated class historically expected after delayed deactivation and reconciliation', async () => {
    const today = businessTime.today();
    const occurrenceDate = addLocalDays(today, 1);
    const inactiveOccurrenceDate = addLocalDays(today, 2);
    const post = (path: string, body: object) =>
      request(app.getHttpServer())
        .post('/api/v1' + path)
        .set('Origin', FRONTEND_ORIGIN)
        .set('Cookie', adminCookie)
        .send(body);

    const student = await post('/admin/students', {
      fullName: 'Histórica API ' + randomUUID(),
    }).expect(201);
    const plan = await post('/admin/plans', {
      name: 'Plan histórico API ' + randomUUID(),
      classCount: 8,
      price: '100.00',
      currency: 'ARS',
    }).expect(201);
    const subscription = await post('/admin/subscriptions', {
      studentId: student.body.id,
      planId: plan.body.id,
      periodStart: new Date(Date.now() - 86_400_000).toISOString(),
      periodEnd: new Date(Date.now() + 4 * 86_400_000).toISOString(),
    }).expect(201);
    const schedule = await post('/admin/schedules', {
      dayOfWeek: isoDayOfWeek(occurrenceDate),
      startTime: '10:00',
      endTime: '11:00',
      defaultCapacity: 10,
    }).expect(201);
    await post('/admin/enrollments', {
      studentId: student.body.id,
      subscriptionId: subscription.body.id,
      scheduleId: schedule.body.id,
      validFrom: today,
      validUntil: addLocalDays(today, 3),
    }).expect(201);
    const inactiveSchedule = await post('/admin/schedules', {
      dayOfWeek: isoDayOfWeek(inactiveOccurrenceDate),
      startTime: '12:00',
      endTime: '13:00',
      defaultCapacity: 10,
    }).expect(201);
    await post('/admin/enrollments', {
      studentId: student.body.id,
      subscriptionId: subscription.body.id,
      scheduleId: inactiveSchedule.body.id,
      validFrom: today,
      validUntil: addLocalDays(today, 3),
    }).expect(201);
    await post('/admin/class-sessions/generate', {
      dateFrom: occurrenceDate,
      dateTo: inactiveOccurrenceDate,
    }).expect(200);

    const classSession = await prisma.classSession.findUniqueOrThrow({
      where: {
        scheduleId_occurrenceDate: {
          scheduleId: schedule.body.id,
          occurrenceDate: localDateToDatabaseDate(occurrenceDate),
        },
      },
    });
    const inactiveClassSession = await prisma.classSession.findUniqueOrThrow({
      where: {
        scheduleId_occurrenceDate: {
          scheduleId: inactiveSchedule.body.id,
          occurrenceDate: localDateToDatabaseDate(inactiveOccurrenceDate),
        },
      },
    });
    clock.set(new Date(classSession.endAt.getTime() + 61 * 60_000));
    await post('/admin/students/' + student.body.id + '/deactivate', {}).expect(
      200,
    );
    await attendance.reconcileDue();

    await request(app.getHttpServer())
      .get(
        '/api/v1/admin/class-sessions/' +
          classSession.id +
          '/expected-students',
      )
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toMatchObject([
          {
            studentId: student.body.id,
            subscriptionId: subscription.body.id,
          },
        ]);
      });
    await request(app.getHttpServer())
      .get('/api/v1/admin/class-sessions/' + classSession.id + '/attendance')
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.totals).toMatchObject({
          expected: 1,
          present: 0,
          absent: 1,
          unresolved: 0,
          notRequiredInactive: 0,
        });
        expect(body.items[0]).toMatchObject({
          studentId: student.body.id,
          state: 'ABSENT',
          attendance: { status: 'ABSENT', source: 'SYSTEM' },
        });
      });

    clock.set(new Date(inactiveClassSession.endAt.getTime() + 61 * 60_000));
    await post('/admin/students/' + student.body.id + '/reactivate', {}).expect(
      200,
    );
    await attendance.reconcileDue();

    await request(app.getHttpServer())
      .get(
        '/api/v1/admin/class-sessions/' +
          inactiveClassSession.id +
          '/expected-students',
      )
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(0));
    await request(app.getHttpServer())
      .get(
        '/api/v1/admin/class-sessions/' +
          inactiveClassSession.id +
          '/attendance',
      )
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.totals).toMatchObject({ expected: 0, absent: 0 });
        expect(body.items).toHaveLength(0);
      });
    await request(app.getHttpServer())
      .get('/api/v1/admin/students/' + student.body.id)
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => expect(body.isActive).toBe(true));
  });
});
