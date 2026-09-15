import { NestExpressApplication } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma.service';
import { RecoveriesService } from '../src/recoveries/recoveries.service';
import { AttendanceService } from '../src/attendance/attendance.service';
import { AttendanceChallengeService } from '../src/attendance/attendance-challenge.service';
import { ClassSessionsService } from '../src/class-sessions/class-sessions.service';
import { EnrollmentsService } from '../src/enrollments/enrollments.service';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { StudentsService } from '../src/students/students.service';
import { createTestApp, createAdmin } from './helpers';
import { qrFixture, QrClock } from './qr-fixture';

const NOW = new Date('2035-01-10T15:00:00Z');
describe('Recoveries rules, constraints and races (PostgreSQL integration)', () => {
  const clock = new QrClock();
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let recoveries: RecoveriesService;
  let attendance: AttendanceService;
  let classes: ClassSessionsService;
  let enrollments: EnrollmentsService;
  let adminId: string;
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
    recoveries = app.get(RecoveriesService);
    attendance = app.get(AttendanceService);
    classes = app.get(ClassSessionsService);
    enrollments = app.get(EnrollmentsService);
    adminId = (await createAdmin(app, prisma)).admin.id;
  });
  beforeEach(() => clock.set(NOW));
  afterAll(async () => {
    if (app) await app.close();
  });
  async function target(
    capacity = 10,
    date = '2035-01-11',
    scheduleId?: string,
  ) {
    const schedule = scheduleId
      ? { id: scheduleId }
      : await prisma.schedule.create({
          data: {
            dayOfWeek: 4,
            startMinute: 600,
            endMinute: 660,
            defaultCapacity: 30,
          },
        });
    return prisma.classSession.create({
      data: {
        scheduleId: schedule.id,
        occurrenceDate: new Date(date + 'T00:00:00Z'),
        startAt: new Date(date + 'T13:00:00Z'),
        endAt: new Date(date + 'T14:00:00Z'),
        capacity,
      },
    });
  }
  async function fixture() {
    const f = await qrFixture(prisma);
    await prisma.subscription.update({
      where: { id: f.subscription.id },
      data: { classAllowance: 1 },
    });
    const original = await prisma.attendance.create({
      data: {
        studentId: f.student.id,
        subscriptionId: f.subscription.id,
        classSessionId: f.session.id,
        status: 'ABSENT',
        originalStatus: 'ABSENT',
        source: 'SYSTEM',
        recordedAt: NOW,
      },
    });
    await prisma.classSession.update({
      where: { id: f.session.id },
      data: { status: 'COMPLETED', attendanceClosedAt: NOW },
    });
    return { ...f, original };
  }
  const authorize = (absence: string, session: string) =>
    recoveries.authorize(absence, session, adminId);
  const cancel = (id: string) =>
    recoveries.cancel(id, 'Cambio solicitado', adminId);
  const enrollment = (
    f: Awaited<ReturnType<typeof fixture>>,
    scheduleId: string,
  ) => ({
    studentId: f.student.id,
    subscriptionId: f.subscription.id,
    scheduleId,
    validFrom: '2035-01-11',
    validUntil: '2035-01-31',
  });
  async function present(
    f: Awaited<ReturnType<typeof fixture>>,
    t: Awaited<ReturnType<typeof target>>,
  ) {
    clock.set(t.startAt);
    const qr = await app.get(AttendanceChallengeService).issue(t.id, adminId);
    return attendance.markPresent(t.id, f.student.id, qr.challenge);
  }
  it('PRESENT at zero remaining preserves the original and never double consumes, including concurrent replay', async () => {
    const f = await fixture(),
      t = await target();
    const r = await authorize(f.original.id, t.id);
    expect((await classes.expectedStudents(t.id)).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recoveryId: r.id,
          enrollmentId: null,
          origin: 'RECOVERY',
        }),
      ]),
    );
    clock.set(t.startAt);
    const { challenge } = await app
      .get(AttendanceChallengeService)
      .issue(t.id, adminId);
    const results = await Promise.all([
      attendance.markPresent(t.id, f.student.id, challenge),
      attendance.markPresent(t.id, f.student.id, challenge),
    ]);
    expect(results[0].attendance!.id).toBe(results[1].attendance!.id);
    expect(results[0]).toMatchObject({
      recoveryId: r.id,
      origin: 'RECOVERY',
      attendance: { consumesAllowance: false },
      classSummary: { usedClasses: 1, remainingClasses: 0 },
    });
    expect(
      await prisma.attendance.findUnique({ where: { id: f.original.id } }),
    ).toEqual(f.original);
    expect((await recoveries.get(r.id)).state).toBe('COMPLETED');
    await expect(cancel(r.id)).rejects.toMatchObject({ status: 409 });
    clock.set(new Date(+t.startAt + 61_000));
    await expect(
      attendance.markPresent(t.id, f.student.id, challenge),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('reconciliation records a Recovery ABSENT once without consumption and refuses a chain', async () => {
    const f = await fixture(),
      t = await target();
    const r = await authorize(f.original.id, t.id);
    clock.set(new Date(+t.endAt + 3_600_000));
    await attendance.reconcileDue();
    await attendance.reconcileDue();
    const result = await prisma.attendance.findUniqueOrThrow({
      where: { recoveryId: r.id },
    });
    expect(result.status).toBe('ABSENT');
    expect(
      (await attendance.getClassSummary(f.subscription.id)).usedClasses,
    ).toBe(1);
    expect((await recoveries.get(r.id)).state).toBe('MISSED');
    await expect(
      authorize(result.id, (await target(10, '2035-01-12')).id),
    ).rejects.toMatchObject({ status: 409 });
    expect(await prisma.attendance.count({ where: { recoveryId: r.id } })).toBe(
      1,
    );
  });
  it('rejects habitual targets and later Enrollment overlap in both directions', async () => {
    const f = await fixture(),
      normal = await target(10, '2035-01-17', f.session.scheduleId);
    await expect(authorize(f.original.id, normal.id)).rejects.toMatchObject({
      status: 409,
    });
    const t = await target();
    await authorize(f.original.id, t.id);
    await expect(
      enrollments.create(enrollment(f, t.scheduleId), adminId),
    ).rejects.toMatchObject({ status: 409 });
    const current = await prisma.enrollment.findFirstOrThrow({
      where: { studentId: f.student.id },
    });
    await expect(
      enrollments.changeSchedule(
        current.id,
        { scheduleId: t.scheduleId, effectiveDate: '2035-01-11' },
        adminId,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('same authorization replays once; destination change requires cancellation with retained history', async () => {
    const f = await fixture(),
      t = await target(),
      t2 = await target();
    const rows = await Promise.all(
      Array.from({ length: 4 }, () => authorize(f.original.id, t.id)),
    );
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    await expect(authorize(f.original.id, t2.id)).rejects.toMatchObject({
      status: 409,
    });
    await cancel(rows[0].id);
    await cancel(rows[0].id);
    const second = await authorize(f.original.id, t2.id);
    expect(second.id).not.toBe(rows[0].id);
    expect(
      await prisma.recovery.count({
        where: { originalAbsenceId: f.original.id },
      }),
    ).toBe(2);
    expect(
      await prisma.auditLog.count({
        where: { action: 'RECOVERY_CANCELLED', entityId: rows[0].id },
      }),
    ).toBe(1);
  });
  it('class cancellation derives unavailability, releases eligibility and never invents Recovery ABSENT', async () => {
    const f = await fixture(),
      t = await target(),
      r = await authorize(f.original.id, t.id);
    await classes.cancel(t.id, { reason: 'Clase suspendida' }, adminId);
    expect(await recoveries.get(r.id)).toMatchObject({
      state: 'UNAVAILABLE',
      unavailableReason: 'CLASS_CANCELLED',
      cancelledAt: null,
    });
    clock.set(new Date(+t.endAt + 3_600_000));
    await attendance.reconcileDue();
    expect(await prisma.attendance.count({ where: { recoveryId: r.id } })).toBe(
      0,
    );
    expect(
      (await attendance.getClassSummary(f.subscription.id)).usedClasses,
    ).toBe(1);
    await cancel(r.id);
  });
  it('subscription cancellation before target prevents PRESENT and ABSENT without deleting authorization', async () => {
    const f = await fixture(),
      t = await target(),
      r = await authorize(f.original.id, t.id);
    await app.get(SubscriptionsService).cancel(f.subscription.id, adminId);
    expect(await recoveries.get(r.id)).toMatchObject({
      state: 'UNAVAILABLE',
      unavailableReason: 'SUBSCRIPTION_INELIGIBLE',
      cancelledAt: null,
    });
    await expect(present(f, t)).rejects.toThrow();
    clock.set(new Date(+t.endAt + 3_600_000));
    await attendance.reconcileDue();
    expect(await prisma.attendance.count({ where: { recoveryId: r.id } })).toBe(
      0,
    );
  });
  it('historical inactivity prevents ABSENT, while later deactivation preserves an eligible past recovery', async () => {
    const f = await fixture(),
      t = await target(),
      r = await authorize(f.original.id, t.id);
    await app.get(StudentsService).deactivate(f.student.id, adminId);
    clock.set(new Date(+t.endAt + 3_600_000));
    await attendance.reconcileDue();
    expect(await prisma.attendance.count({ where: { recoveryId: r.id } })).toBe(
      0,
    );
    clock.set(NOW);
    const g = await fixture(),
      u = await target(),
      s = await authorize(g.original.id, u.id);
    clock.set(new Date(+u.startAt + 1));
    await app.get(StudentsService).deactivate(g.student.id, adminId);
    clock.set(new Date(+u.endAt + 3_600_000));
    await attendance.reconcileDue();
    expect(
      (
        await prisma.attendance.findUniqueOrThrow({
          where: { recoveryId: s.id },
        })
      ).status,
    ).toBe('ABSENT');
    expect(
      (await attendance.getClassSummary(g.subscription.id)).usedClasses,
    ).toBe(1);
  });
  it('rejects foreign periods, inactive Students, PRESENT origins and already-started targets', async () => {
    const f = await fixture();
    await expect(
      authorize(f.original.id, (await target(10, '2035-02-01')).id),
    ).rejects.toMatchObject({ status: 409 });
    const t = await target();
    clock.set(t.startAt);
    await expect(authorize(f.original.id, t.id)).rejects.toMatchObject({
      status: 409,
    });
    clock.set(NOW);
    await prisma.attendance.update({
      where: { id: f.original.id },
      data: { status: 'PRESENT' },
    });
    await expect(authorize(f.original.id, t.id)).rejects.toMatchObject({
      status: 409,
    });
  });
  it('last seat is serialized between two Recoveries and capacity reductions', async () => {
    const f = await fixture(),
      g = await fixture(),
      t = await target(1);
    const results = await Promise.allSettled([
      authorize(f.original.id, t.id),
      authorize(g.original.id, t.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const u = await target(2);
    await authorize(
      (results[0].status === 'rejected' ? f : g).original.id,
      u.id,
    );
    const h = await fixture();
    await authorize(h.original.id, u.id);
    await expect(
      classes.updateCapacity(u.id, { capacity: 1 }, adminId),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('last seat is serialized between Enrollment and Recovery', async () => {
    const f = await fixture(),
      g = await fixture(),
      t = await target(1);
    const results = await Promise.allSettled([
      authorize(f.original.id, t.id),
      enrollments.create(enrollment(g, t.scheduleId), adminId),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await classes.expectedStudents(t.id)).items).toHaveLength(1);
  });
  it('authorization competing with class cancellation or subscription cancellation leaves no usable invalid Recovery', async () => {
    const f = await fixture(),
      t = await target();
    await Promise.allSettled([
      authorize(f.original.id, t.id),
      classes.cancel(t.id, { reason: 'Cancelación concurrente' }, adminId),
    ]);
    const records = await prisma.recovery.findMany({
      where: { recoverySessionId: t.id },
    });
    for (const r of records)
      expect((await recoveries.get(r.id)).state).toBe('UNAVAILABLE');
    const g = await fixture(),
      u = await target();
    await Promise.allSettled([
      authorize(g.original.id, u.id),
      app.get(SubscriptionsService).cancel(g.subscription.id, adminId),
    ]);
    const rows = await prisma.recovery.findMany({
      where: { recoverySessionId: u.id },
    });
    for (const r of rows)
      expect((await recoveries.get(r.id)).state).toBe('UNAVAILABLE');
  });
  it('database constraints reject forged links, duplicate authorizations and historical mutation/deletion', async () => {
    const f = await fixture(),
      t = await target(),
      r = await authorize(f.original.id, t.id),
      g = await fixture();
    const data = {
      studentId: f.student.id,
      subscriptionId: f.subscription.id,
      originalAbsenceId: f.original.id,
      recoverySessionId: t.id,
      authorizedByAdminId: adminId,
      authorizedAt: NOW,
    };
    await expect(prisma.recovery.create({ data })).rejects.toMatchObject({
      code: 'P2002',
    });
    await expect(
      prisma.recovery.create({
        data: {
          ...data,
          studentId: g.student.id,
          subscriptionId: g.subscription.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.attendance.create({
        data: {
          studentId: g.student.id,
          subscriptionId: g.subscription.id,
          classSessionId: t.id,
          recoveryId: r.id,
          status: 'PRESENT',
          originalStatus: 'PRESENT',
          source: 'STUDENT',
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.recovery.update({
        where: { id: r.id },
        data: { recoverySessionId: (await target()).id },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.attendance.update({
        where: { id: f.original.id },
        data: { status: 'PRESENT', source: 'STUDENT' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.attendance.delete({ where: { id: f.original.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.recovery.delete({ where: { id: r.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.student.delete({ where: { id: f.student.id } }),
    ).rejects.toThrow();
    await cancel(r.id);
    await expect(
      prisma.attendance.create({
        data: {
          studentId: f.student.id,
          subscriptionId: f.subscription.id,
          classSessionId: t.id,
          recoveryId: r.id,
          status: 'PRESENT',
          originalStatus: 'PRESENT',
          source: 'STUDENT',
        },
      }),
    ).rejects.toThrow();
  });
  it('reproduces the previous Student/Schedule cycle with blocked real transactions and completes without deadlock', async () => {
    const f = await fixture(),
      t = await target();
    let release!: () => void;
    let ready!: (pid: number) => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prepared = new Promise<number>((resolve) => {
      ready = resolve;
    });
    const gate = prisma.$transaction(
      async (tx) => {
        const [pid] = await tx.$queryRaw<{ pid: number }[]>(
          Prisma.sql`SELECT pg_backend_pid() AS pid`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "ClassSession" WHERE id=${t.id} FOR UPDATE`,
        );
        ready(pid.pid);
        await released;
      },
      { timeout: 10000 },
    );
    const pid = await prepared;
    const recovery = authorize(f.original.id, t.id);
    const caughtRecovery = recovery.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    async function waitBlocked(blocker: number) {
      for (let i = 0; i < 100; i++) {
        const rows = await prisma.$queryRaw<{ pid: number }[]>(
          Prisma.sql`SELECT pid FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid))`,
        );
        if (rows.length) return rows[0].pid;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Expected lock wait was not observed');
    }
    let candidate: Promise<unknown> | undefined;
    try {
      const recoveryPid = await waitBlocked(pid);
      candidate = enrollments.create(enrollment(f, t.scheduleId), adminId).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await waitBlocked(recoveryPid);
    } finally {
      release();
    }
    await gate;
    const results = await Promise.all([caughtRecovery, candidate]);
    expect(results[0]).toHaveProperty('value');
    expect(results[1]).toMatchObject({ error: { status: 409 } });
    expect(
      await prisma.recovery.count({
        where: { originalAbsenceId: f.original.id },
      }),
    ).toBe(1);
  });
  it('double cancellation is atomic and releases the seat for another authorization', async () => {
    const f = await fixture(),
      g = await fixture(),
      t = await target(1),
      r = await authorize(f.original.id, t.id);
    const cancelled = await Promise.all([cancel(r.id), cancel(r.id)]);
    expect(cancelled[0].cancelledAt).toEqual(cancelled[1].cancelledAt);
    await authorize(g.original.id, t.id);
    expect((await classes.expectedStudents(t.id)).items).toHaveLength(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'RECOVERY_CANCELLED', entityId: r.id },
      }),
    ).toBe(1);
  });
  it('capacity reduction racing authorization cannot undercut the occupied union', async () => {
    const f = await fixture(),
      g = await fixture(),
      t = await target(2);
    await authorize(f.original.id, t.id);
    const results = await Promise.allSettled([
      authorize(g.original.id, t.id),
      classes.updateCapacity(t.id, { capacity: 1 }, adminId),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const current = await prisma.classSession.findUniqueOrThrow({
      where: { id: t.id },
    });
    expect(
      (await classes.expectedStudents(t.id)).items.length,
    ).toBeLessThanOrEqual(current.capacity);
  });
  it('time changes keep the same authorization and QR follows the real target window', async () => {
    const f = await fixture(),
      t = await target(),
      r = await authorize(f.original.id, t.id);
    await classes.updateTime(
      t.id,
      { startAt: '2035-01-11T17:00:00Z', endAt: '2035-01-11T18:00:00Z' },
      adminId,
    );
    expect((await recoveries.get(r.id)).targetClassSession.startAt).toEqual(
      new Date('2035-01-11T17:00:00Z'),
    );
    clock.set(t.startAt);
    await expect(
      app.get(AttendanceChallengeService).issue(t.id, adminId),
    ).rejects.toMatchObject({ status: 409 });
    clock.set(new Date('2035-01-11T17:00:00Z'));
    const qr = await app.get(AttendanceChallengeService).issue(t.id, adminId);
    expect(
      (await attendance.markPresent(t.id, f.student.id, qr.challenge))
        .recoveryId,
    ).toBe(r.id);
  });
  it('PRESENT held on Student across closing races the reconciler without duplicate or consuming results', async () => {
    const f = await fixture(),
      t = await target(),
      r = await authorize(f.original.id, t.id);
    const closesAt = new Date(+t.endAt + 3_600_000);
    clock.set(new Date(+closesAt - 1000));
    const qr = await app.get(AttendanceChallengeService).issue(t.id, adminId);
    let release!: () => void;
    let ready!: (pid: number) => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prepared = new Promise<number>((resolve) => {
      ready = resolve;
    });
    const gate = prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ pid: number }[]>(
          Prisma.sql`SELECT pg_backend_pid() AS pid`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Student" WHERE id=${f.student.id} FOR UPDATE`,
        );
        ready(rows[0].pid);
        await released;
      },
      { timeout: 10000 },
    );
    const pid = await prepared;
    const mark = attendance.markPresent(t.id, f.student.id, qr.challenge).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    let reconcile: Promise<unknown> | undefined;
    try {
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const rows = await prisma.$queryRaw<{ pid: number }[]>(
          Prisma.sql`SELECT pid FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`,
        );
        if (rows.length) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      clock.set(closesAt);
      reconcile = attendance.reconcileDue();
    } finally {
      release();
    }
    await gate;
    expect(await mark).toMatchObject({ error: { status: 409 } });
    await reconcile;
    expect(await prisma.attendance.count({ where: { recoveryId: r.id } })).toBe(
      1,
    );
    expect((await recoveries.get(r.id)).state).toBe('MISSED');
    expect(
      (await attendance.getClassSummary(f.subscription.id)).usedClasses,
    ).toBe(1);
  });
  it('a time edit cannot move Recovery before its authorization or outside the contractual period', async () => {
    const f = await fixture(),
      t = await target(10, '2035-01-10');
    await prisma.classSession.update({
      where: { id: t.id },
      data: {
        startAt: new Date('2035-01-10T18:00:00Z'),
        endAt: new Date('2035-01-10T19:00:00Z'),
      },
    });
    await authorize(f.original.id, t.id);
    await expect(
      classes.updateTime(
        t.id,
        { startAt: '2035-01-10T12:00:00Z', endAt: '2035-01-10T13:00:00Z' },
        adminId,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const g = await fixture(),
      u = await target();
    await prisma.subscription.update({
      where: { id: g.subscription.id },
      data: { periodEnd: new Date('2035-01-11T18:00:00Z') },
    });
    await authorize(g.original.id, u.id);
    await expect(
      classes.updateTime(
        u.id,
        { startAt: '2035-01-11T19:00:00Z', endAt: '2035-01-11T20:00:00Z' },
        adminId,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
