import { StudentsService } from '../src/students/students.service';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma.service';
import { AttendanceService } from '../src/attendance/attendance.service';
import { AttendanceCorrectionsService } from '../src/attendance/attendance-corrections.service';
import { AttendanceChallengeService } from '../src/attendance/attendance-challenge.service';
import { RecoveriesService } from '../src/recoveries/recoveries.service';
import { createTestApp, createAdmin } from './helpers';
import { qrFixture, QrClock, QR_NOW } from './qr-fixture';

describe('Administrative corrections and manual attendance (PostgreSQL)', () => {
  const clock = new QrClock();
  let app: NestExpressApplication, prisma: PrismaService;
  let attendance: AttendanceService,
    corrections: AttendanceCorrectionsService,
    recoveries: RecoveriesService;
  let adminId: string;
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
    attendance = app.get(AttendanceService);
    corrections = app.get(AttendanceCorrectionsService);
    recoveries = app.get(RecoveriesService);
    adminId = (await createAdmin(app, prisma)).admin.id;
  });
  beforeEach(() => clock.set(QR_NOW));
  afterAll(async () => {
    if (app) await app.close();
  });
  const manual = (f: Awaited<ReturnType<typeof qrFixture>>) =>
    attendance.markManualPresent(
      f.session.id,
      f.student.id,
      'Dispositivo sin batería',
      adminId,
    );
  const correct = (id: string, status: 'PRESENT' | 'ABSENT') =>
    corrections.correct(id, status, 'Verificación de asistencia', adminId);
  async function absent() {
    const f = await qrFixture(prisma);
    const record = await prisma.attendance.create({
      data: {
        studentId: f.student.id,
        subscriptionId: f.subscription.id,
        classSessionId: f.session.id,
        originalStatus: 'ABSENT',
        status: 'ABSENT',
        source: 'SYSTEM',
        recordedAt: clock.now(),
      },
    });
    return { ...f, record };
  }
  async function recoveryFixture() {
    const f = await absent();
    const schedule = await prisma.schedule.create({
      data: {
        dayOfWeek: 4,
        startMinute: 600,
        endMinute: 660,
        defaultCapacity: 20,
      },
    });
    const target = await prisma.classSession.create({
      data: {
        scheduleId: schedule.id,
        occurrenceDate: new Date('2035-01-11'),
        startAt: new Date('2035-01-11T13:00:00Z'),
        endAt: new Date('2035-01-11T14:00:00Z'),
        capacity: 20,
      },
    });
    return { ...f, target };
  }
  async function waitBlocked(pid: number) {
    for (let i = 0; i < 100; i++) {
      const rows = await prisma.$queryRaw<{ pid: number }[]>(
        Prisma.sql`SELECT pid FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`,
      );
      if (rows.length) return rows[0].pid;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Expected PostgreSQL lock wait');
  }
  async function gate(table: 'ClassSession' | 'Student', id: string) {
    let release!: () => void, ready!: (pid: number) => void;
    const released = new Promise<void>((r) => {
      release = r;
    });
    const prepared = new Promise<number>((r) => {
      ready = r;
    });
    const done = prisma.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<{ pid: number }[]>(
          Prisma.sql`SELECT pg_backend_pid() AS pid`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR UPDATE`,
        );
        ready(row.pid);
        await released;
      },
      { timeout: 10000 },
    );
    return { pid: await prepared, release, done };
  }
  const settled = <T>(p: Promise<T>) =>
    p.then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error: error as { status?: number } }),
    );

  it('normal ABSENT to PRESENT and back preserves original identity, source, timestamp and usedClasses', async () => {
    const f = await absent();
    const first = await correct(f.record.id, 'PRESENT');
    expect(first.attendance).toMatchObject({
      status: 'PRESENT',
      originalStatus: 'ABSENT',
      source: 'SYSTEM',
      recordedAt: f.record.recordedAt,
      consumesAllowance: true,
    });
    expect(
      (await attendance.getClassSummary(f.subscription.id)).usedClasses,
    ).toBe(1);
    await correct(f.record.id, 'ABSENT');
    expect(
      (await attendance.getClassSummary(f.subscription.id)).usedClasses,
    ).toBe(1);
    const history = await corrections.history(f.record.id, {
      page: 1,
      limit: 20,
    });
    expect(
      history.items.map((x) => [x.sequence, x.previousStatus, x.targetStatus]),
    ).toEqual([
      [1, 'ABSENT', 'PRESENT'],
      [2, 'PRESENT', 'ABSENT'],
    ]);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: f.record.id,
          action: 'ATTENDANCE_CORRECTED',
          actorType: 'ADMIN',
          actorId: adminId,
        },
      }),
    ).toBe(2);
  });
  it('manual normal PRESENT records attribution, rejects overwrite and does not require QR', async () => {
    const f = await qrFixture(prisma);
    const result = await manual(f);
    expect(result.attendance).toMatchObject({
      source: 'ADMIN',
      status: 'PRESENT',
      originalStatus: 'PRESENT',
    });
    expect(
      await prisma.attendance.findUnique({
        where: { id: result.attendance!.id },
      }),
    ).toMatchObject({
      createdByAdminId: adminId,
      creationReason: 'Dispositivo sin batería',
      recordedAt: QR_NOW,
    });
    await expect(manual(f)).rejects.toMatchObject({ status: 409 });
    await correct(result.attendance!.id, 'ABSENT');
    expect(
      (await attendance.getClassSummary(f.subscription.id)).usedClasses,
    ).toBe(1);
  });
  it('no-op produces neither history nor audit, including repeated identical corrections', async () => {
    const f = await absent();
    expect((await correct(f.record.id, 'ABSENT')).correction).toBeNull();
    await Promise.all([
      correct(f.record.id, 'PRESENT'),
      correct(f.record.id, 'PRESENT'),
    ]);
    expect(
      await prisma.attendanceCorrection.count({
        where: { attendanceId: f.record.id },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { entityId: f.record.id } }),
    ).toBe(1);
  });
  it('invalid Admin rolls the correction and effective state back together', async () => {
    const f = await absent();
    await expect(
      corrections.correct(
        f.record.id,
        'PRESENT',
        'Motivo válido',
        randomUUID(),
      ),
    ).rejects.toThrow();
    expect(
      (
        await prisma.attendance.findUniqueOrThrow({
          where: { id: f.record.id },
        })
      ).status,
    ).toBe('ABSENT');
    expect(
      await prisma.attendanceCorrection.count({
        where: { attendanceId: f.record.id },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { entityId: f.record.id } }),
    ).toBe(0);
  });
  it('closed existing Attendance can be corrected, closed missing Attendance is an anomaly', async () => {
    const f = await absent();
    await prisma.classSession.update({
      where: { id: f.session.id },
      data: { status: 'COMPLETED', attendanceClosedAt: clock.now() },
    });
    clock.set(new Date('2036-01-01'));
    await correct(f.record.id, 'PRESENT');
    const g = await qrFixture(prisma);
    await prisma.classSession.update({
      where: { id: g.session.id },
      data: { status: 'COMPLETED', attendanceClosedAt: clock.now() },
    });
    await expect(manual(g)).rejects.toThrow('Anomalía de integridad');
  });
  it('manual requires normal window, eligibility and remaining allowance', async () => {
    const f = await qrFixture(prisma);
    clock.set(new Date('2035-01-09'));
    await expect(manual(f)).rejects.toMatchObject({ status: 409 });
    clock.set(QR_NOW);
    await app.get(StudentsService).deactivate(f.student.id, adminId);
    await expect(manual(f)).rejects.toMatchObject({ status: 409 });
    clock.set(new Date(+QR_NOW + 1000));
    await app.get(StudentsService).reactivate(f.student.id, adminId);
    await prisma.subscription.update({
      where: { id: f.subscription.id },
      data: { status: 'CANCELLED', cancelledAt: new Date('2035-01-09') },
    });
    await expect(manual(f)).rejects.toMatchObject({ status: 404 });
    expect(
      await prisma.attendance.count({ where: { studentId: f.student.id } }),
    ).toBe(0);
    const g = await absent();
    await prisma.subscription.update({
      where: { id: g.subscription.id },
      data: { classAllowance: 1 },
    });
    const extra = await prisma.classSession.create({
      data: {
        scheduleId: g.session.scheduleId,
        occurrenceDate: new Date('2035-01-17'),
        startAt: new Date('2035-01-17T13:00:00Z'),
        endAt: new Date('2035-01-17T14:00:00Z'),
        capacity: 30,
      },
    });
    clock.set(extra.startAt);
    await expect(
      attendance.markManualPresent(
        extra.id,
        g.student.id,
        'Intento sin saldo',
        adminId,
      ),
    ).rejects.toThrow('agotó');
  });
  it('cancelled classes reject manual and corrections without destroying inconsistent evidence', async () => {
    const f = await absent();
    await prisma.classSession.update({
      where: { id: f.session.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: clock.now(),
        cancelledByAdminId: adminId,
        cancellationReason: 'Inconsistencia histórica',
      },
    });
    await expect(correct(f.record.id, 'PRESENT')).rejects.toThrow(
      'Anomalía de integridad',
    );
    await expect(manual(f)).rejects.toMatchObject({ status: 409 });
    expect(
      await prisma.attendance.findUnique({ where: { id: f.record.id } }),
    ).toEqual(f.record);
  });
  it('pending Recovery blocks origin correction; explicit cancellation preserves history and releases it', async () => {
    const f = await recoveryFixture();
    const r = await recoveries.authorize(f.record.id, f.target.id, adminId);
    await expect(correct(f.record.id, 'PRESENT')).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      prisma.attendance.update({
        where: { id: f.record.id },
        data: { status: 'PRESENT' },
      }),
    ).rejects.toThrow();
    await recoveries.cancel(r.id, 'Cambio administrativo', adminId);
    await correct(f.record.id, 'PRESENT');
    expect(
      (await prisma.recovery.findUniqueOrThrow({ where: { id: r.id } }))
        .cancelledAt,
    ).not.toBeNull();
  });
  it('manual Recovery at zero remaining and both result corrections consume zero; result blocks origin', async () => {
    const f = await recoveryFixture();
    await prisma.subscription.update({
      where: { id: f.subscription.id },
      data: { classAllowance: 1 },
    });
    const r = await recoveries.authorize(f.record.id, f.target.id, adminId);
    clock.set(f.target.startAt);
    const response = await attendance.markManualPresent(
      f.target.id,
      f.student.id,
      'Dispositivo averiado',
      adminId,
    );
    expect(response.attendance).toMatchObject({
      recoveryId: r.id,
      consumesAllowance: false,
      source: 'ADMIN',
    });
    await correct(response.attendance!.id, 'ABSENT');
    expect((await recoveries.get(r.id)).state).toBe('MISSED');
    expect(
      (await attendance.getClassSummary(f.subscription.id)).usedClasses,
    ).toBe(1);
    await expect(correct(f.record.id, 'PRESENT')).rejects.toMatchObject({
      status: 409,
    });
    await correct(response.attendance!.id, 'PRESENT');
    expect((await recoveries.get(r.id)).state).toBe('COMPLETED');
    expect(
      (await attendance.getClassSummary(f.subscription.id)).usedClasses,
    ).toBe(1);
    await expect(correct(f.record.id, 'PRESENT')).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      recoveries.cancel(r.id, 'No permitido', adminId),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('PostgreSQL protects immutable originals, correction history, sequence, reason and actor shape', async () => {
    const f = await absent();
    const c = (await correct(f.record.id, 'PRESENT')).correction!;
    for (const data of [
      { originalStatus: 'PRESENT' as const },
      { source: 'STUDENT' as const },
      { recordedAt: new Date() },
      { recoveryId: randomUUID() },
    ])
      await expect(
        prisma.attendance.update({ where: { id: f.record.id }, data }),
      ).rejects.toThrow();
    await expect(
      prisma.attendanceCorrection.update({
        where: { id: c.id },
        data: { reason: 'Reescrito' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.attendanceCorrection.delete({ where: { id: c.id } }),
    ).rejects.toThrow();
    const data = {
      attendanceId: f.record.id,
      sequence: 1,
      previousStatus: 'PRESENT' as const,
      targetStatus: 'ABSENT' as const,
      reason: 'Duplicado',
      correctedByAdminId: adminId,
    };
    await expect(
      prisma.attendanceCorrection.create({ data }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.attendanceCorrection.create({
        data: { ...data, sequence: 2, reason: ' ' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.auditLog.create({
        data: { actorType: 'SYSTEM', actorId: adminId, action: 'INVALID' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.auditLog.create({
        data: { actorType: 'ADMIN', actorId: null, action: 'INVALID' },
      }),
    ).rejects.toThrow();
  });
  it('two opposite corrections serialize without lost state or sequence', async () => {
    const f = await absent(),
      g = await gate('ClassSession', f.session.id);
    const first = settled(correct(f.record.id, 'PRESENT'));
    let second: ReturnType<typeof settled> | undefined;
    try {
      await waitBlocked(g.pid);
      second = settled(correct(f.record.id, 'ABSENT'));
    } finally {
      g.release();
    }
    await g.done;
    expect((await first).ok).toBe(true);
    expect((await second)!.ok).toBe(true);
    const history = await corrections.history(f.record.id, {
      page: 1,
      limit: 20,
    });
    expect(history.items.map((x) => x.sequence)).toEqual([1, 2]);
    expect(
      (
        await prisma.attendance.findUniqueOrThrow({
          where: { id: f.record.id },
        })
      ).status,
    ).toBe('ABSENT');
  });
  it('Admin PRESENT and Student PRESENT race produces one Attendance and one creation audit', async () => {
    const f = await qrFixture(prisma);
    const qr = await app
      .get(AttendanceChallengeService)
      .issue(f.session.id, adminId);
    const results = await Promise.all([
      settled(manual(f)),
      settled(attendance.markPresent(f.session.id, f.student.id, qr.challenge)),
    ]);
    for (const r of results) if (!r.ok) expect(r.error.status).toBe(409);
    expect(
      await prisma.attendance.count({
        where: { studentId: f.student.id, classSessionId: f.session.id },
      }),
    ).toBe(1);
    const record = await prisma.attendance.findUniqueOrThrow({
      where: {
        studentId_classSessionId: {
          studentId: f.student.id,
          classSessionId: f.session.id,
        },
      },
    });
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: record.id,
          action: {
            in: [
              'ATTENDANCE_PRESENT_RECORDED',
              'ATTENDANCE_MANUAL_PRESENT_RECORDED',
            ],
          },
        },
      }),
    ).toBe(1);
  });
  it('Admin held across closing loses to the window and reconciler records one absence', async () => {
    const f = await qrFixture(prisma),
      g = await gate('Student', f.student.id);
    const pending = settled(manual(f));
    let reconciliation: Promise<unknown> | undefined;
    try {
      await waitBlocked(g.pid);
      clock.set(new Date('2035-01-10T16:00:00Z'));
      reconciliation = attendance.reconcileDue();
    } finally {
      g.release();
    }
    await g.done;
    expect(await pending).toMatchObject({ ok: false, error: { status: 409 } });
    await reconciliation;
    const records = await prisma.attendance.findMany({
      where: { studentId: f.student.id },
    });
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('ABSENT');
  });
  it('correction and reconciler preserve corrected result with no duplicate', async () => {
    const f = await absent();
    clock.set(new Date('2035-01-10T16:00:00Z'));
    await Promise.all([
      correct(f.record.id, 'PRESENT'),
      attendance.reconcileDue(),
    ]);
    expect(
      await prisma.attendance.count({ where: { studentId: f.student.id } }),
    ).toBe(1);
    expect(
      (
        await prisma.attendance.findUniqueOrThrow({
          where: { id: f.record.id },
        })
      ).status,
    ).toBe('PRESENT');
  });
  it('origin correction and Recovery authorization cannot commit incompatible outcomes', async () => {
    const f = await recoveryFixture();
    const results = await Promise.all([
      settled(correct(f.record.id, 'PRESENT')),
      settled(recoveries.authorize(f.record.id, f.target.id, adminId)),
    ]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    for (const r of results) if (!r.ok) expect(r.error.status).toBe(409);
    const record = await prisma.attendance.findUniqueOrThrow({
      where: { id: f.record.id },
    });
    expect(
      await prisma.recovery.count({
        where: { originalAbsenceId: f.record.id, cancelledAt: null },
      }),
    ).toBe(record.status === 'ABSENT' ? 1 : 0);
  });
  it('origin correction and cancellation serialize; retry after cancellation succeeds', async () => {
    const f = await recoveryFixture();
    const r = await recoveries.authorize(f.record.id, f.target.id, adminId);
    const results = await Promise.all([
      settled(correct(f.record.id, 'PRESENT')),
      settled(recoveries.cancel(r.id, 'Cambio solicitado', adminId)),
    ]);
    expect(results[1].ok).toBe(true);
    if (!results[0].ok) expect(results[0].error.status).toBe(409);
    await correct(f.record.id, 'PRESENT');
    expect(
      await prisma.attendanceCorrection.count({
        where: { attendanceId: f.record.id },
      }),
    ).toBe(1);
  });
});
