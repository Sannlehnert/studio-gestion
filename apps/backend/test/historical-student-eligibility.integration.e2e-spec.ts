import { AttendanceChallengeService } from '../src/attendance/attendance-challenge.service';
import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AttendanceStatus, ClassSessionStatus, Prisma } from '@prisma/client';
import { AttendanceService } from '../src/attendance/attendance.service';
import { ClassSessionsService } from '../src/class-sessions/class-sessions.service';
import { PrismaService } from '../src/prisma.service';
import { StudentStatusHistoryService } from '../src/students/student-status-history.service';
import { StudentsService } from '../src/students/students.service';
import { Clock } from '../src/time/clock';
import { createAdmin, createTestApp } from './helpers';

class MutableClock implements Clock {
  constructor(private current: Date) {}

  now() {
    return new Date(this.current);
  }

  set(instant: Date) {
    this.current = new Date(instant);
  }
}

describe('Historical student eligibility with PostgreSQL (integration)', () => {
  const t0 = new Date('2035-01-01T12:00:00.000Z');
  const classStart = new Date('2035-01-10T13:00:00.000Z');
  const classEnd = new Date('2035-01-10T14:00:00.000Z');
  const afterWindow = new Date('2035-01-10T15:01:00.000Z');
  let actorId: string;
  const clock = new MutableClock(t0);
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let students: StudentsService;
  let history: StudentStatusHistoryService;
  let classSessions: ClassSessionsService;
  let attendance: AttendanceService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
    actorId = (await createAdmin(app, prisma)).admin.id;
    students = app.get(StudentsService);
    history = app.get(StudentStatusHistoryService);
    classSessions = app.get(ClassSessionsService);
    attendance = app.get(AttendanceService);
  });

  beforeEach(() => clock.set(t0));

  afterAll(async () => {
    if (app) await app.close();
  });

  async function contractWithClass(startAt = classStart, endAt = classEnd) {
    const student = await students.create(
      'Elegibilidad ' + randomUUID(),
      actorId,
    );
    const plan = await prisma.plan.create({
      data: {
        name: 'Plan histórico ' + randomUUID(),
        classCount: 8,
        price: new Prisma.Decimal('100.00'),
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
        currency: plan.currency,
        periodStart: new Date('2035-01-01T00:00:00.000Z'),
        periodEnd: new Date('2035-02-01T00:00:00.000Z'),
      },
    });
    const schedule = await prisma.schedule.create({
      data: {
        dayOfWeek: 3,
        startMinute: 600,
        endMinute: 660,
        defaultCapacity: 10,
      },
    });
    const enrollment = await prisma.enrollment.create({
      data: {
        studentId: student.id,
        subscriptionId: subscription.id,
        scheduleId: schedule.id,
        validFrom: new Date('2035-01-01T00:00:00.000Z'),
        validUntil: new Date('2035-02-01T00:00:00.000Z'),
      },
    });
    const session = await prisma.classSession.create({
      data: {
        scheduleId: schedule.id,
        occurrenceDate: new Date('2035-01-10T00:00:00.000Z'),
        startAt,
        endAt,
        capacity: 10,
      },
    });
    return { student, subscription, schedule, enrollment, session };
  }

  it('stores multiple active cycles with exact semi-open boundaries and idempotent replays', async () => {
    const student = await students.create('Ciclos ' + randomUUID(), actorId);
    const firstEnd = new Date('2035-01-03T12:00:00.000Z');
    const secondStart = new Date('2035-01-05T12:00:00.000Z');
    const secondEnd = new Date('2035-01-07T12:00:00.000Z');
    const thirdStart = new Date('2035-01-09T12:00:00.000Z');

    clock.set(firstEnd);
    await students.deactivate(student.id, actorId);
    await students.deactivate(student.id, actorId);
    clock.set(secondStart);
    await students.reactivate(student.id, actorId);
    await students.reactivate(student.id, actorId);
    clock.set(secondEnd);
    await students.deactivate(student.id, actorId);
    clock.set(thirdStart);
    await students.reactivate(student.id, actorId);

    await expect(history.wasActiveAt(prisma, student.id, t0)).resolves.toBe(
      true,
    );
    await expect(
      history.wasActiveAt(prisma, student.id, firstEnd),
    ).resolves.toBe(false);
    await expect(
      history.wasActiveAt(
        prisma,
        student.id,
        new Date(secondStart.getTime() - 1),
      ),
    ).resolves.toBe(false);
    await expect(
      history.wasActiveAt(prisma, student.id, secondStart),
    ).resolves.toBe(true);
    await expect(
      history.wasActiveAt(prisma, student.id, secondEnd),
    ).resolves.toBe(false);
    await expect(
      history.wasActiveAt(prisma, student.id, thirdStart),
    ).resolves.toBe(true);

    expect(
      await prisma.studentActivePeriod.findMany({
        where: { studentId: student.id },
        orderBy: { validFrom: 'asc' },
        select: { validFrom: true, validUntil: true },
      }),
    ).toEqual([
      { validFrom: t0, validUntil: firstEnd },
      { validFrom: secondStart, validUntil: secondEnd },
      { validFrom: thirdStart, validUntil: null },
    ]);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: student.id,
          action: {
            in: ['STUDENT_DEACTIVATED', 'STUDENT_REACTIVATED'],
          },
        },
      }),
    ).toBe(4);

    const plan = await prisma.plan.create({
      data: {
        name: 'Plan ciclos ' + randomUUID(),
        classCount: 8,
        price: new Prisma.Decimal('100.00'),
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
        currency: plan.currency,
        periodStart: new Date('2035-01-01T00:00:00.000Z'),
        periodEnd: new Date('2035-01-20T00:00:00.000Z'),
      },
    });
    const schedule = await prisma.schedule.create({
      data: {
        dayOfWeek: 1,
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
        validFrom: new Date('2035-01-01T00:00:00.000Z'),
        validUntil: new Date('2035-01-20T00:00:00.000Z'),
      },
    });
    const sessionStarts = [2, 4, 6, 8, 10].map(
      (day) =>
        new Date(`2035-01-${String(day).padStart(2, '0')}T13:00:00.000Z`),
    );
    const sessions = await Promise.all(
      sessionStarts.map((startAt) =>
        prisma.classSession.create({
          data: {
            scheduleId: schedule.id,
            occurrenceDate: new Date(
              Date.UTC(
                startAt.getUTCFullYear(),
                startAt.getUTCMonth(),
                startAt.getUTCDate(),
              ),
            ),
            startAt,
            endAt: new Date(startAt.getTime() + 60 * 60_000),
            capacity: 10,
          },
        }),
      ),
    );
    const expectedCounts = [];
    for (const session of sessions) {
      expectedCounts.push(
        (await classSessions.expectedStudents(session.id)).items.length,
      );
    }
    expect(expectedCounts).toEqual([1, 0, 1, 0, 1]);
  });

  it('creates a delayed ABSENT when the student was active at class start (case A)', async () => {
    const fixture = await contractWithClass();
    clock.set(afterWindow);
    await students.deactivate(fixture.student.id, actorId);

    await attendance.reconcileDue();

    await expect(
      prisma.attendance.findUnique({
        where: {
          studentId_classSessionId: {
            studentId: fixture.student.id,
            classSessionId: fixture.session.id,
          },
        },
      }),
    ).resolves.toMatchObject({
      status: AttendanceStatus.ABSENT,
      source: 'SYSTEM',
      subscriptionId: fixture.subscription.id,
    });
    await expect(
      prisma.classSession.findUniqueOrThrow({
        where: { id: fixture.session.id },
      }),
    ).resolves.toMatchObject({ status: ClassSessionStatus.COMPLETED });
  });

  it('does not invent an absence for inactivity at class start, even after reactivation (cases B, C and E)', async () => {
    const remainsInactive = await contractWithClass();
    clock.set(new Date('2035-01-05T12:00:00.000Z'));
    await students.deactivate(remainsInactive.student.id, actorId);

    clock.set(t0);
    const reactivated = await contractWithClass();
    clock.set(new Date('2035-01-05T12:00:00.000Z'));
    await students.deactivate(reactivated.student.id, actorId);
    clock.set(afterWindow);
    await students.reactivate(reactivated.student.id, actorId);

    await attendance.reconcileDue();

    for (const fixture of [remainsInactive, reactivated]) {
      expect(
        await prisma.attendance.count({
          where: { classSessionId: fixture.session.id },
        }),
      ).toBe(0);
      await expect(
        prisma.classSession.findUniqueOrThrow({
          where: { id: fixture.session.id },
        }),
      ).resolves.toMatchObject({ status: ClassSessionStatus.COMPLETED });
    }
    expect(
      (await classSessions.expectedStudents(reactivated.session.id)).items,
    ).toHaveLength(0);
    expect(
      await prisma.enrollment.count({
        where: { studentId: reactivated.student.id },
      }),
    ).toBe(1);
  });

  it('preserves PRESENT and expected history after deactivation (cases D and E)', async () => {
    const fixture = await contractWithClass();
    clock.set(new Date('2035-01-10T13:30:00.000Z'));
    await attendance.markPresent(
      fixture.session.id,
      fixture.student.id,
      (
        await app
          .get(AttendanceChallengeService)
          .issue(fixture.session.id, actorId)
      ).challenge,
    );
    clock.set(afterWindow);
    await students.deactivate(fixture.student.id, actorId);
    await attendance.reconcileDue();

    const adminView = await attendance.getAdminClassAttendance(
      fixture.session.id,
    );
    expect(adminView.totals).toMatchObject({
      expected: 1,
      present: 1,
      absent: 0,
      notRequiredInactive: 0,
    });
    expect(adminView.items[0]).toMatchObject({
      studentId: fixture.student.id,
      state: 'PRESENT',
    });
    await expect(
      prisma.attendance.findUniqueOrThrow({
        where: {
          studentId_classSessionId: {
            studentId: fixture.student.id,
            classSessionId: fixture.session.id,
          },
        },
      }),
    ).resolves.toMatchObject({ status: AttendanceStatus.PRESENT });
    await expect(
      attendance.getClassSummary(fixture.subscription.id, fixture.student.id),
    ).resolves.toMatchObject({
      usedClasses: 1,
      remainingClasses: 7,
      integrityStatus: 'OK',
    });
  });

  it('filters student upcoming classes historically before applying the requested limit', async () => {
    const fixture = await contractWithClass();
    clock.set(new Date('2035-01-05T12:00:00.000Z'));
    await students.deactivate(fixture.student.id, actorId);
    clock.set(new Date('2035-01-10T13:30:00.000Z'));
    await students.reactivate(fixture.student.id, actorId);

    const futureSchedule = await prisma.schedule.create({
      data: {
        dayOfWeek: 4,
        startMinute: 600,
        endMinute: 660,
        defaultCapacity: 10,
      },
    });
    await prisma.enrollment.create({
      data: {
        studentId: fixture.student.id,
        subscriptionId: fixture.subscription.id,
        scheduleId: futureSchedule.id,
        validFrom: new Date('2035-01-01T00:00:00.000Z'),
        validUntil: new Date('2035-02-01T00:00:00.000Z'),
      },
    });
    const futureSession = await prisma.classSession.create({
      data: {
        scheduleId: futureSchedule.id,
        occurrenceDate: new Date('2035-01-11T00:00:00.000Z'),
        startAt: new Date('2035-01-11T13:00:00.000Z'),
        endAt: new Date('2035-01-11T14:00:00.000Z'),
        capacity: 10,
      },
    });

    const result = await attendance.upcoming(fixture.student.id, { limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].classSession.id).toBe(futureSession.id);
  });

  it('serializes status changes with reconciliation and keeps projection/history consistent', async () => {
    const activeAtClass = await contractWithClass();
    clock.set(afterWindow);
    await Promise.all([
      students.deactivate(activeAtClass.student.id, actorId),
      attendance.reconcileDue(),
    ]);
    expect(
      await prisma.attendance.count({
        where: {
          studentId: activeAtClass.student.id,
          classSessionId: activeAtClass.session.id,
          status: AttendanceStatus.ABSENT,
        },
      }),
    ).toBe(1);

    clock.set(t0);
    const inactiveAtClass = await contractWithClass();
    clock.set(new Date('2035-01-05T12:00:00.000Z'));
    await students.deactivate(inactiveAtClass.student.id, actorId);
    clock.set(afterWindow);
    await Promise.all([
      students.reactivate(inactiveAtClass.student.id, actorId),
      attendance.reconcileDue(),
    ]);
    expect(
      await prisma.attendance.count({
        where: { classSessionId: inactiveAtClass.session.id },
      }),
    ).toBe(0);

    clock.set(new Date('2035-01-20T12:00:00.000Z'));
    const concurrent = await students.create(
      'Concurrencia ' + randomUUID(),
      actorId,
    );
    await Promise.all([
      students.deactivate(concurrent.id, actorId),
      students.deactivate(concurrent.id, actorId),
    ]);
    await Promise.all([
      students.reactivate(concurrent.id, actorId),
      students.reactivate(concurrent.id, actorId),
    ]);

    const stored = await prisma.student.findUniqueOrThrow({
      where: { id: concurrent.id },
      select: { isActive: true },
    });
    const openPeriods = await prisma.studentActivePeriod.count({
      where: { studentId: concurrent.id, validUntil: null },
    });
    expect(stored.isActive).toBe(true);
    expect(openPeriods).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: concurrent.id,
          action: 'STUDENT_DEACTIVATED',
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: concurrent.id,
          action: 'STUDENT_REACTIVATED',
        },
      }),
    ).toBe(1);

    clock.set(new Date('2035-01-21T12:00:00.000Z'));
    const mixed = await students.create(
      'Transiciones mixtas ' + randomUUID(),
      actorId,
    );
    clock.set(new Date('2035-01-22T12:00:00.000Z'));
    await Promise.all([
      students.deactivate(mixed.id, actorId),
      students.reactivate(mixed.id, actorId),
    ]);
    const mixedProjection = await prisma.student.findUniqueOrThrow({
      where: { id: mixed.id },
      select: { isActive: true },
    });
    const mixedOpenPeriods = await prisma.studentActivePeriod.count({
      where: { studentId: mixed.id, validUntil: null },
    });
    expect(mixedOpenPeriods).toBe(mixedProjection.isActive ? 1 : 0);
    expect(
      await prisma.auditLog.count({
        where: { entityId: mixed.id, action: 'STUDENT_DEACTIVATED' },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: mixed.id, action: 'STUDENT_REACTIVATED' },
      }),
    ).toBe(mixedProjection.isActive ? 1 : 0);
  });

  it('enforces period bounds, non-overlap, one open period and historical retention in PostgreSQL', async () => {
    const student = await students.create(
      'Constraints ' + randomUUID(),
      actorId,
    );
    await expect(
      prisma.studentActivePeriod.create({
        data: {
          studentId: student.id,
          validFrom: new Date('2035-01-02T12:00:00.000Z'),
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.studentActivePeriod.create({
        data: {
          studentId: student.id,
          validFrom: new Date('2034-12-31T12:00:00.000Z'),
          validUntil: new Date('2034-12-30T12:00:00.000Z'),
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.student.delete({ where: { id: student.id } }),
    ).rejects.toThrow();
    const period = await prisma.studentActivePeriod.findFirstOrThrow({
      where: { studentId: student.id },
    });
    await expect(
      prisma.studentActivePeriod.delete({ where: { id: period.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.student.update({
        where: { id: student.id },
        data: { isActive: false },
      }),
    ).rejects.toThrow();
    expect(
      await prisma.studentActivePeriod.count({
        where: { studentId: student.id },
      }),
    ).toBe(1);
  });
});
