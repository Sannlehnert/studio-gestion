import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import {
  AttendanceSource,
  AttendanceStatus,
  ClassSessionStatus,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { AttendanceService } from '../src/attendance/attendance.service';
import { ClassSessionsService } from '../src/class-sessions/class-sessions.service';
import { PrismaService } from '../src/prisma.service';
import { BusinessTimeService } from '../src/time/business-time.service';
import {
  addLocalDays,
  isoDayOfWeek,
  localDateToDatabaseDate,
} from '../src/time/business-time';
import { createAdmin, createTestApp } from './helpers';

describe('Attendance persistence with PostgreSQL (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let attendance: AttendanceService;
  let classSessions: ClassSessionsService;
  let businessTime: BusinessTimeService;
  let actorId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    attendance = app.get(AttendanceService);
    classSessions = app.get(ClassSessionsService);
    businessTime = app.get(BusinessTimeService);
    actorId = (await createAdmin(app, prisma)).admin.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function contract(options?: {
    allowance?: number;
    isActive?: boolean;
  }) {
    const allowance = options?.allowance ?? 8;
    const now = new Date();
    const student = await prisma.student.create({
      data: {
        fullName: 'Asistencia ' + randomUUID(),
        isActive: options?.isActive ?? true,
        createdAt: new Date(now.getTime() - 14 * 86_400_000),
      },
    });
    const plan = await prisma.plan.create({
      data: {
        name: 'Plan ' + randomUUID(),
        classCount: allowance,
        price: new Prisma.Decimal('100.00'),
        currency: 'ARS',
      },
    });
    const subscription = await prisma.subscription.create({
      data: {
        studentId: student.id,
        planId: plan.id,
        planName: plan.name,
        classAllowance: allowance,
        agreedPrice: plan.price,
        currency: 'ARS',
        periodStart: new Date(now.getTime() - 7 * 86_400_000),
        periodEnd: new Date(now.getTime() + 7 * 86_400_000),
      },
    });
    return { student, subscription };
  }

  async function addSession(
    fixture: Awaited<ReturnType<typeof contract>>,
    options?: {
      startAt?: Date;
      endAt?: Date;
      status?: ClassSessionStatus;
    },
  ) {
    const now = new Date();
    const today = businessTime.today();
    const startAt = options?.startAt ?? new Date(now.getTime() - 5 * 60_000);
    const endAt = options?.endAt ?? new Date(now.getTime() + 5 * 60_000);
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
        studentId: fixture.student.id,
        subscriptionId: fixture.subscription.id,
        scheduleId: schedule.id,
        validFrom: localDateToDatabaseDate(addLocalDays(today, -1)),
        validUntil: localDateToDatabaseDate(addLocalDays(today, 2)),
      },
    });
    const status = options?.status ?? ClassSessionStatus.SCHEDULED;
    return prisma.classSession.create({
      data: {
        scheduleId: schedule.id,
        occurrenceDate: localDateToDatabaseDate(today),
        startAt,
        endAt,
        capacity: 10,
        status,
        ...(status === ClassSessionStatus.CANCELLED
          ? {
              cancelledAt: now,
              cancelledByAdminId: actorId,
              cancellationReason: 'Clase cancelada para prueba',
            }
          : {}),
      },
    });
  }

  it('records PRESENT idempotently under concurrent retries and audits once', async () => {
    const fixture = await contract();
    const session = await addSession(fixture);
    const [first, replay] = await Promise.all([
      attendance.markPresent(session.id, fixture.student.id),
      attendance.markPresent(session.id, fixture.student.id),
    ]);

    expect(first.attendance?.id).toBe(replay.attendance?.id);
    expect(first.attendance).toMatchObject({
      status: AttendanceStatus.PRESENT,
      source: AttendanceSource.STUDENT,
      subscriptionId: fixture.subscription.id,
    });
    expect(
      await prisma.attendance.count({
        where: { studentId: fixture.student.id, classSessionId: session.id },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'ATTENDANCE_PRESENT_RECORDED',
          entityId: first.attendance!.id,
        },
      }),
    ).toBe(1);
    expect(first.classSummary).toMatchObject({
      usedClasses: 1,
      remainingClasses: 7,
      integrityStatus: 'OK',
    });
  });

  it('creates one ABSENT and closes once when reconcilers compete', async () => {
    const fixture = await contract();
    const now = new Date();
    const session = await addSession(fixture, {
      startAt: new Date(now.getTime() - 3 * 60 * 60_000),
      endAt: new Date(now.getTime() - 2 * 60 * 60_000),
    });

    await Promise.all([
      attendance.reconcileDue(now),
      attendance.reconcileDue(now),
    ]);

    expect(
      await prisma.attendance.findMany({
        where: { classSessionId: session.id },
      }),
    ).toMatchObject([
      {
        status: AttendanceStatus.ABSENT,
        source: AttendanceSource.SYSTEM,
        subscriptionId: fixture.subscription.id,
      },
    ]);
    expect(
      await prisma.classSession.findUniqueOrThrow({
        where: { id: session.id },
      }),
    ).toMatchObject({
      status: ClassSessionStatus.COMPLETED,
      attendanceClosedAt: expect.any(Date),
    });
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'CLASS_SESSION_ATTENDANCE_RECONCILED',
          entityId: session.id,
        },
      }),
    ).toBe(1);
  });

  it('keeps PRESENT versus reconciliation races internally consistent', async () => {
    const fixture = await contract();
    const session = await addSession(fixture);
    const afterClose = new Date(session.endAt.getTime() + 60 * 60_000);

    await Promise.allSettled([
      attendance.markPresent(session.id, fixture.student.id),
      attendance.reconcileDue(afterClose),
    ]);

    const records = await prisma.attendance.findMany({
      where: { studentId: fixture.student.id, classSessionId: session.id },
    });
    expect(records).toHaveLength(1);
    expect([
      `${AttendanceStatus.PRESENT}:${AttendanceSource.STUDENT}`,
      `${AttendanceStatus.ABSENT}:${AttendanceSource.SYSTEM}`,
    ]).toContain(`${records[0].status}:${records[0].source}`);
    const current = await prisma.classSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    if (records[0].status === AttendanceStatus.ABSENT) {
      expect(current.status).toBe(ClassSessionStatus.COMPLETED);
    }
  });

  it('serializes two classes competing for the final allowance', async () => {
    const fixture = await contract({ allowance: 1 });
    const firstSession = await addSession(fixture);
    const secondSession = await addSession(fixture);

    const results = await Promise.allSettled([
      attendance.markPresent(firstSession.id, fixture.student.id),
      attendance.markPresent(secondSession.id, fixture.student.id),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      await prisma.attendance.count({
        where: { subscriptionId: fixture.subscription.id },
      }),
    ).toBe(1);
  });

  it('rejects temporal and cancellation violations and skips inactive students', async () => {
    const now = new Date();
    const future = await contract();
    const futureSession = await addSession(future, {
      startAt: new Date(now.getTime() + 2 * 60 * 60_000),
      endAt: new Date(now.getTime() + 3 * 60 * 60_000),
    });
    await expect(
      attendance.markPresent(futureSession.id, future.student.id),
    ).rejects.toMatchObject({ status: 409 });

    const closed = await contract();
    const closedSession = await addSession(closed, {
      startAt: new Date(now.getTime() - 3 * 60 * 60_000),
      endAt: new Date(now.getTime() - 2 * 60 * 60_000),
    });
    await expect(
      attendance.markPresent(closedSession.id, closed.student.id),
    ).rejects.toMatchObject({ status: 409 });

    const cancelled = await contract();
    const cancelledSession = await addSession(cancelled, {
      status: ClassSessionStatus.CANCELLED,
    });
    await expect(
      attendance.markPresent(cancelledSession.id, cancelled.student.id),
    ).rejects.toMatchObject({ status: 409 });
    await attendance.reconcileDue(new Date(now.getTime() + 3 * 60 * 60_000));
    expect(
      await prisma.attendance.count({
        where: { classSessionId: cancelledSession.id },
      }),
    ).toBe(0);

    const inactive = await contract({ isActive: false });
    const inactiveSession = await addSession(inactive, {
      startAt: new Date(now.getTime() - 3 * 60 * 60_000),
      endAt: new Date(now.getTime() - 2 * 60 * 60_000),
    });
    await attendance.reconcileDue(now);
    expect(
      await prisma.attendance.count({
        where: { classSessionId: inactiveSession.id },
      }),
    ).toBe(0);
    expect(
      await prisma.classSession.findUniqueOrThrow({
        where: { id: inactiveSession.id },
      }),
    ).toMatchObject({ status: ClassSessionStatus.COMPLETED });
  });

  it('does not invent an absence after a subscription cancellation', async () => {
    const fixture = await contract();
    const now = new Date();
    const cancelledAt = new Date(now.getTime() - 30 * 60_000);
    await prisma.subscription.update({
      where: { id: fixture.subscription.id },
      data: { status: SubscriptionStatus.CANCELLED, cancelledAt },
    });
    const session = await addSession(fixture, {
      startAt: new Date(now.getTime() + 30 * 60_000),
      endAt: new Date(now.getTime() + 60 * 60_000),
    });
    await attendance.reconcileDue(
      new Date(session.endAt.getTime() + 60 * 60_000),
    );
    expect(
      await prisma.attendance.count({ where: { classSessionId: session.id } }),
    ).toBe(0);
    expect(
      await prisma.classSession.findUniqueOrThrow({
        where: { id: session.id },
      }),
    ).toMatchObject({ status: ClassSessionStatus.COMPLETED });
  });

  it('enforces ownership, source, uniqueness, closure and historical FKs in PostgreSQL', async () => {
    const fixture = await contract();
    const other = await contract();
    const session = await addSession(fixture);
    const valid = await prisma.attendance.create({
      data: {
        studentId: fixture.student.id,
        subscriptionId: fixture.subscription.id,
        classSessionId: session.id,
        status: AttendanceStatus.PRESENT,
        source: AttendanceSource.STUDENT,
      },
    });
    await expect(
      prisma.attendance.create({
        data: {
          studentId: fixture.student.id,
          subscriptionId: fixture.subscription.id,
          classSessionId: session.id,
          status: AttendanceStatus.PRESENT,
          source: AttendanceSource.STUDENT,
        },
      }),
    ).rejects.toThrow();
    const otherSession = await addSession(fixture);
    await expect(
      prisma.attendance.create({
        data: {
          studentId: fixture.student.id,
          subscriptionId: other.subscription.id,
          classSessionId: otherSession.id,
          status: AttendanceStatus.PRESENT,
          source: AttendanceSource.STUDENT,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.attendance.create({
        data: {
          studentId: fixture.student.id,
          subscriptionId: fixture.subscription.id,
          classSessionId: otherSession.id,
          status: AttendanceStatus.ABSENT,
          source: AttendanceSource.STUDENT,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.classSession.update({
        where: { id: session.id },
        data: { status: ClassSessionStatus.COMPLETED },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.student.delete({ where: { id: fixture.student.id } }),
    ).rejects.toThrow();
    expect(valid.id).toBeTruthy();
  });

  it('blocks class cancellation after attendance exists and exposes overconsumption', async () => {
    const fixture = await contract({ allowance: 1 });
    const first = await addSession(fixture);
    const second = await addSession(fixture);
    for (const session of [first, second]) {
      await prisma.attendance.create({
        data: {
          studentId: fixture.student.id,
          subscriptionId: fixture.subscription.id,
          classSessionId: session.id,
          status: AttendanceStatus.PRESENT,
          source: AttendanceSource.STUDENT,
        },
      });
    }
    await expect(
      classSessions.cancel(first.id, { reason: 'Intento tardío' }, actorId),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      attendance.getClassSummary(fixture.subscription.id),
    ).resolves.toMatchObject({
      classAllowance: 1,
      usedClasses: 2,
      remainingClasses: 0,
      integrityStatus: 'OVERCONSUMED',
      overconsumedClasses: 1,
    });
  });
});
