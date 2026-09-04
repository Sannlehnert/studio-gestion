import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ClassSessionStatus } from '@prisma/client';
import { ClassSessionsService } from '../src/class-sessions/class-sessions.service';
import { EnrollmentsService } from '../src/enrollments/enrollments.service';
import { PlansService } from '../src/plans/plans.service';
import { PrismaService } from '../src/prisma.service';
import { SchedulesService } from '../src/schedules/schedules.service';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import {
  isoDayOfWeek,
  localDateToDatabaseDate,
} from '../src/time/business-time';
import { createAdmin, createTestApp } from './helpers';

describe('Scheduling persistence with PostgreSQL (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let plans: PlansService;
  let subscriptions: SubscriptionsService;
  let schedules: SchedulesService;
  let enrollments: EnrollmentsService;
  let classSessions: ClassSessionsService;
  let actorId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    plans = app.get(PlansService);
    subscriptions = app.get(SubscriptionsService);
    schedules = app.get(SchedulesService);
    enrollments = app.get(EnrollmentsService);
    classSessions = app.get(ClassSessionsService);
    actorId = (await createAdmin(app, prisma)).admin.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function contract(
    name: string,
    periodStart = '2099-09-01T00:00:00-03:00',
    periodEnd = '2099-10-01T00:00:00-03:00',
  ) {
    const student = await prisma.student.create({
      data: { fullName: name + ' ' + randomUUID() },
    });
    const plan = await plans.create(
      {
        name: 'Plan ' + randomUUID(),
        classCount: 8,
        price: '100.00',
        currency: 'ARS',
      },
      actorId,
    );
    const subscription = await subscriptions.create(
      {
        studentId: student.id,
        planId: plan.id,
        periodStart,
        periodEnd,
      },
      actorId,
    );
    return { student, subscription };
  }

  it('generates idempotent snapshots and keeps exceptions out of Schedule', async () => {
    const schedule = await schedules.create(
      {
        dayOfWeek: isoDayOfWeek('2099-09-08'),
        startTime: '19:00',
        endTime: '21:00',
        defaultCapacity: 2,
      },
      actorId,
    );
    const [first, concurrent] = await Promise.all([
      classSessions.generate(
        { dateFrom: '2099-09-01', dateTo: '2099-09-30' },
        actorId,
      ),
      classSessions.generate(
        { dateFrom: '2099-09-01', dateTo: '2099-09-30' },
        actorId,
      ),
    ]);
    expect(first.createdCount + concurrent.createdCount).toBeGreaterThan(0);
    expect(
      await prisma.classSession.count({ where: { scheduleId: schedule.id } }),
    ).toBe(5);
    const replay = await classSessions.generate(
      { dateFrom: '2099-09-01', dateTo: '2099-09-30' },
      actorId,
    );
    expect(replay.createdCount).toBe(0);

    const original = await prisma.classSession.findFirstOrThrow({
      where: { scheduleId: schedule.id },
      orderBy: { occurrenceDate: 'asc' },
    });
    await schedules.update(
      schedule.id,
      { startTime: '18:00', endTime: '20:00', defaultCapacity: 3 },
      actorId,
    );
    const unchanged = await prisma.classSession.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(unchanged.startAt).toEqual(original.startAt);
    expect(unchanged.endAt).toEqual(original.endAt);
    expect(unchanged.capacity).toBe(2);

    const occurrenceDate = original.occurrenceDate.toISOString().slice(0, 10);
    await classSessions.updateTime(
      original.id,
      {
        startAt: occurrenceDate + 'T20:00:00-03:00',
        endAt: occurrenceDate + 'T22:00:00-03:00',
      },
      actorId,
    );
    await classSessions.updateCapacity(original.id, { capacity: 4 }, actorId);
    expect((await schedules.getById(schedule.id)).defaultCapacity).toBe(3);

    await classSessions.cancel(
      original.id,
      { reason: 'Feriado local confirmado' },
      actorId,
    );
    await classSessions.cancel(
      original.id,
      { reason: 'Reintento idempotente' },
      actorId,
    );
    expect(
      await prisma.auditLog.count({
        where: { action: 'CLASS_SESSION_CANCELLED', entityId: original.id },
      }),
    ).toBe(1);
    expect(await classSessions.expectedStudents(original.id)).toMatchObject({
      attendanceRequired: false,
      items: [],
    });

    await schedules.deactivate(schedule.id, actorId);
    await classSessions.generate(
      { dateFrom: '2099-10-01', dateTo: '2099-10-31' },
      actorId,
    );
    expect(
      await prisma.classSession.count({
        where: {
          scheduleId: schedule.id,
          occurrenceDate: {
            gte: localDateToDatabaseDate('2099-10-01'),
            lte: localDateToDatabaseDate('2099-10-31'),
          },
        },
      }),
    ).toBe(0);
  });

  it('preserves enrollment history and derives expected students', async () => {
    const firstSchedule = await schedules.create(
      {
        dayOfWeek: isoDayOfWeek('2099-09-08'),
        startTime: '19:00',
        endTime: '21:00',
        defaultCapacity: 2,
      },
      actorId,
    );
    const secondSchedule = await schedules.create(
      {
        dayOfWeek: isoDayOfWeek('2099-09-10'),
        startTime: '19:00',
        endTime: '21:00',
        defaultCapacity: 2,
      },
      actorId,
    );
    const martina = await contract('Martina');
    const sofia = await contract('Sofía');
    const martinaEnrollment = await enrollments.create(
      {
        studentId: martina.student.id,
        subscriptionId: martina.subscription.id,
        scheduleId: firstSchedule.id,
        validFrom: '2099-09-01',
        validUntil: '2099-10-01',
      },
      actorId,
    );
    await enrollments.create(
      {
        studentId: sofia.student.id,
        subscriptionId: sofia.subscription.id,
        scheduleId: firstSchedule.id,
        validFrom: '2099-09-01',
        validUntil: '2099-10-01',
      },
      actorId,
    );
    await classSessions.generate(
      { dateFrom: '2099-09-01', dateTo: '2099-09-30' },
      actorId,
    );
    const early = await prisma.classSession.findUniqueOrThrow({
      where: {
        scheduleId_occurrenceDate: {
          scheduleId: firstSchedule.id,
          occurrenceDate: localDateToDatabaseDate('2099-09-08'),
        },
      },
    });
    expect((await classSessions.expectedStudents(early.id)).items).toHaveLength(
      2,
    );
    await expect(
      classSessions.updateCapacity(early.id, { capacity: 1 }, actorId),
    ).rejects.toMatchObject({ status: 409 });

    const changed = await enrollments.changeSchedule(
      martinaEnrollment.id,
      { scheduleId: secondSchedule.id, effectiveDate: '2099-09-15' },
      actorId,
    );
    const replay = await enrollments.changeSchedule(
      martinaEnrollment.id,
      { scheduleId: secondSchedule.id, effectiveDate: '2099-09-15' },
      actorId,
    );
    expect(replay.newEnrollment.id).toBe(changed.newEnrollment.id);
    expect(changed.endedEnrollment.validUntil).toBe('2099-09-15');
    expect(changed.newEnrollment.validFrom).toBe('2099-09-15');
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'ENROLLMENT_SCHEDULE_CHANGED',
          entityId: changed.newEnrollment.id,
        },
      }),
    ).toBe(1);

    const newClass = await prisma.classSession.findUniqueOrThrow({
      where: {
        scheduleId_occurrenceDate: {
          scheduleId: secondSchedule.id,
          occurrenceDate: localDateToDatabaseDate('2099-09-17'),
        },
      },
    });
    expect(await classSessions.expectedStudents(newClass.id)).toMatchObject({
      attendanceRequired: true,
      items: [
        {
          studentId: martina.student.id,
          enrollmentId: changed.newEnrollment.id,
          subscriptionId: martina.subscription.id,
        },
      ],
    });
  });

  it('serializes two admins competing for the final schedule capacity', async () => {
    const schedule = await schedules.create(
      {
        dayOfWeek: isoDayOfWeek('2098-01-07'),
        startTime: '10:00',
        endTime: '11:00',
        defaultCapacity: 1,
      },
      actorId,
    );
    const first = await contract(
      'Cupo A',
      '2098-01-01T00:00:00-03:00',
      '2098-02-01T00:00:00-03:00',
    );
    const second = await contract(
      'Cupo B',
      '2098-01-01T00:00:00-03:00',
      '2098-02-01T00:00:00-03:00',
    );
    const create = (fixture: typeof first) =>
      enrollments.create(
        {
          studentId: fixture.student.id,
          subscriptionId: fixture.subscription.id,
          scheduleId: schedule.id,
          validFrom: '2098-01-01',
          validUntil: '2098-02-01',
        },
        actorId,
      );
    const results = await Promise.allSettled([create(first), create(second)]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      await prisma.enrollment.count({ where: { scheduleId: schedule.id } }),
    ).toBe(1);
  });

  it('rejects a weekday edit that would orphan a future enrollment', async () => {
    const dayOfWeek = isoDayOfWeek('2099-09-08');
    const schedule = await schedules.create(
      {
        dayOfWeek,
        startTime: '08:00',
        endTime: '09:00',
        defaultCapacity: 2,
      },
      actorId,
    );
    const fixture = await contract('Vigencia corta');
    await enrollments.create(
      {
        studentId: fixture.student.id,
        subscriptionId: fixture.subscription.id,
        scheduleId: schedule.id,
        validFrom: '2099-09-08',
        validUntil: '2099-09-09',
      },
      actorId,
    );
    await expect(
      schedules.update(
        schedule.id,
        { dayOfWeek: dayOfWeek === 7 ? 1 : dayOfWeek + 1 },
        actorId,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect((await schedules.getById(schedule.id)).dayOfWeek).toBe(dayOfWeek);
  });

  it('enforces temporal, duplicate, cancellation and overlap invariants in PostgreSQL', async () => {
    await expect(
      prisma.schedule.create({
        data: {
          dayOfWeek: 8,
          startMinute: 1200,
          endMinute: 1100,
          defaultCapacity: 0,
        },
      }),
    ).rejects.toThrow();

    const fixture = await contract(
      'Constraints',
      '2097-01-01T00:00:00-03:00',
      '2097-02-01T00:00:00-03:00',
    );
    const schedule = await schedules.create(
      {
        dayOfWeek: isoDayOfWeek('2097-01-08'),
        startTime: '19:00',
        endTime: '21:00',
        defaultCapacity: 5,
      },
      actorId,
    );
    const enrollment = await enrollments.create(
      {
        studentId: fixture.student.id,
        subscriptionId: fixture.subscription.id,
        scheduleId: schedule.id,
        validFrom: '2097-01-01',
        validUntil: '2097-02-01',
      },
      actorId,
    );
    await expect(
      prisma.enrollment.create({
        data: {
          studentId: fixture.student.id,
          subscriptionId: fixture.subscription.id,
          scheduleId: schedule.id,
          validFrom: localDateToDatabaseDate('2097-01-15'),
          validUntil: localDateToDatabaseDate('2097-01-25'),
        },
      }),
    ).rejects.toThrow();
    const unrelatedStudent = await prisma.student.create({
      data: { fullName: 'Cruce ' + randomUUID() },
    });
    await expect(
      prisma.enrollment.create({
        data: {
          studentId: unrelatedStudent.id,
          subscriptionId: fixture.subscription.id,
          scheduleId: schedule.id,
          validFrom: localDateToDatabaseDate('2097-01-15'),
          validUntil: localDateToDatabaseDate('2097-01-25'),
        },
      }),
    ).rejects.toThrow();
    expect(enrollment.id).toBeTruthy();

    const occurrenceDate = localDateToDatabaseDate('2097-01-08');
    const classSession = await prisma.classSession.create({
      data: {
        scheduleId: schedule.id,
        occurrenceDate,
        startAt: new Date('2097-01-08T22:00:00Z'),
        endAt: new Date('2097-01-09T00:00:00Z'),
        capacity: 5,
      },
    });
    await expect(
      prisma.classSession.create({
        data: {
          scheduleId: schedule.id,
          occurrenceDate,
          startAt: new Date('2097-01-08T23:00:00Z'),
          endAt: new Date('2097-01-09T01:00:00Z'),
          capacity: 5,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.classSession.update({
        where: { id: classSession.id },
        data: { status: ClassSessionStatus.CANCELLED },
      }),
    ).rejects.toThrow();
    expect(fixture.subscription.operationalStatus).toBe('ACTIVE');
  });
});
