import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { AttendanceService } from '../src/attendance/attendance.service';
import { AttendanceChallengeService } from '../src/attendance/attendance-challenge.service';
import { TokenService } from '../src/auth/services/token.service';
import { ClassSessionsService } from '../src/class-sessions/class-sessions.service';
import { PrismaService } from '../src/prisma.service';
import { StudentsService } from '../src/students/students.service';
import { createAdmin, createTestApp } from './helpers';
import { QrClock, qrFixture, QR_NOW } from './qr-fixture';

describe('QR security and concurrency with PostgreSQL (integration)', () => {
  const clock = new QrClock();
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let qr: AttendanceChallengeService;
  let attendance: AttendanceService;
  let adminId: string;
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
    qr = app.get(AttendanceChallengeService);
    attendance = app.get(AttendanceService);
    adminId = (await createAdmin(app, prisma)).admin.id;
  });
  beforeEach(() => clock.set(QR_NOW));
  afterAll(async () => {
    if (app) await app.close();
  });
  const issue = (id: string) => qr.issue(id, adminId);

  it('persists only the hash, constraints and safe audit metadata', async () => {
    const f = await qrFixture(prisma);
    const result = await issue(f.session.id);
    const record = await prisma.attendanceChallenge.findFirstOrThrow({
      where: { classSessionId: f.session.id },
    });
    expect(record.tokenHash).toBe(
      app.get(TokenService).hashToken(result.challenge),
    );
    expect(record).not.toHaveProperty('challenge');
    expect(Object.values(record)).not.toContain(result.challenge);
    expect(result.expiresAt.getTime() - QR_NOW.getTime()).toBe(60_000);
    const audit = await prisma.auditLog.findMany({
      where: { entityId: record.id },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(result.challenge);
    expect(JSON.stringify(audit)).not.toContain(record.tokenHash);
    const data = {
      classSessionId: f.session.id,
      createdByAdminId: adminId,
      tokenHash: record.tokenHash,
      createdAt: QR_NOW,
      expiresAt: result.expiresAt,
    };
    await expect(
      prisma.attendanceChallenge.create({ data }),
    ).rejects.toMatchObject({ code: 'P2002' });
    for (const invalid of [
      { expiresAt: QR_NOW },
      { revokedAt: new Date(QR_NOW.getTime() - 1) },
      { tokenHash: 'bad' },
      { classSessionId: randomUUID() },
      { createdByAdminId: randomUUID() },
    ]) {
      await expect(
        prisma.attendanceChallenge.create({
          data: {
            ...data,
            tokenHash: app.get(TokenService).hashToken(randomUUID()),
            ...invalid,
          },
        }),
      ).rejects.toThrow();
    }
    await expect(
      prisma.classSession.delete({ where: { id: f.session.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.admin.delete({ where: { id: adminId } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('shares a challenge among eligible Students and preserves replay with no remaining allowance', async () => {
    const f = await qrFixture(prisma);
    const other = await qrFixture(prisma, f.session.scheduleId);
    await prisma.subscription.update({
      where: { id: f.subscription.id },
      data: { classAllowance: 1 },
    });
    const { challenge } = await issue(f.session.id);
    const [a, b] = await Promise.all([
      attendance.markPresent(f.session.id, f.student.id, challenge),
      attendance.markPresent(f.session.id, f.student.id, challenge),
    ]);
    expect(a.attendance!.id).toBe(b.attendance!.id);
    expect(a.classSummary.remainingClasses).toBe(0);
    await attendance.markPresent(f.session.id, other.student.id, challenge);
    expect(
      await prisma.attendance.count({
        where: { classSessionId: f.session.id },
      }),
    ).toBe(2);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'ATTENDANCE_PRESENT_RECORDED',
          entityId: a.attendance!.id,
        },
      }),
    ).toBe(1);
  });

  it('rejects random, cross-class, revoked and expired tokens including replays', async () => {
    const f = await qrFixture(prisma),
      other = await qrFixture(prisma);
    const a = await issue(f.session.id),
      b = await issue(other.session.id);
    await expect(
      attendance.markPresent(
        f.session.id,
        f.student.id,
        'sgq_' + 'A'.repeat(43),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      attendance.markPresent(f.session.id, f.student.id, b.challenge),
    ).rejects.toMatchObject({ status: 409 });
    await attendance.markPresent(f.session.id, f.student.id, a.challenge);
    clock.set(a.expiresAt);
    await expect(
      attendance.markPresent(f.session.id, f.student.id, a.challenge),
    ).rejects.toMatchObject({ status: 409 });
    clock.set(QR_NOW);
    await prisma.attendanceChallenge.updateMany({
      where: { classSessionId: f.session.id },
      data: { revokedAt: QR_NOW },
    });
    await expect(
      attendance.markPresent(f.session.id, f.student.id, a.challenge),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await prisma.attendance.count({
        where: { classSessionId: f.session.id },
      }),
    ).toBe(1);
  });

  it('rotates without cooldown, retains original expiry and bounds active and stored rows', async () => {
    const f = await qrFixture(prisma);
    const a = await issue(f.session.id);
    clock.set(new Date(QR_NOW.getTime() + 1000));
    const b = await issue(f.session.id);
    await attendance.markPresent(f.session.id, f.student.id, a.challenge);
    const c = await issue(f.session.id);
    await expect(
      attendance.markPresent(f.session.id, f.student.id, a.challenge),
    ).rejects.toMatchObject({ status: 409 });
    await attendance.markPresent(f.session.id, f.student.id, b.challenge);
    await attendance.markPresent(f.session.id, f.student.id, c.challenge);
    const bRecord = await prisma.attendanceChallenge.findUniqueOrThrow({
      where: { tokenHash: app.get(TokenService).hashToken(b.challenge) },
    });
    expect(bRecord.expiresAt).toEqual(b.expiresAt);
    for (let i = 0; i < 8; i++) await issue(f.session.id);
    expect(
      await prisma.attendanceChallenge.count({
        where: { classSessionId: f.session.id, revokedAt: null },
      }),
    ).toBe(2);
    expect(
      await prisma.attendanceChallenge.count({
        where: { classSessionId: f.session.id },
      }),
    ).toBe(3);
    clock.set(new Date(QR_NOW.getTime() + 120000));
    await issue(f.session.id);
    expect(
      await prisma.attendanceChallenge.count({
        where: { classSessionId: f.session.id },
      }),
    ).toBe(1);
  });

  it('serializes two Admin emissions and accepts both results', async () => {
    const f = await qrFixture(prisma);
    const otherAdmin = (await createAdmin(app, prisma)).admin.id;
    const [a, b] = await Promise.all([
      issue(f.session.id),
      qr.issue(f.session.id, otherAdmin),
    ]);
    expect(a.challenge).not.toBe(b.challenge);
    await attendance.markPresent(f.session.id, f.student.id, a.challenge);
    await attendance.markPresent(f.session.id, f.student.id, b.challenge);
    expect(
      await prisma.attendanceChallenge.count({
        where: { classSessionId: f.session.id, revokedAt: null },
      }),
    ).toBe(2);
  });

  it('allows a scanned predecessor while rotation races with PRESENT', async () => {
    const f = await qrFixture(prisma);
    const a = await issue(f.session.id);
    const [present] = await Promise.all([
      attendance.markPresent(f.session.id, f.student.id, a.challenge),
      issue(f.session.id),
    ]);
    expect(present.attendance!.status).toBe('PRESENT');
  });

  it('cancellation and PRESENT cannot both succeed; cancelled tokens are unusable', async () => {
    const f = await qrFixture(prisma);
    const a = await issue(f.session.id);
    const results = await Promise.allSettled([
      app
        .get(ClassSessionsService)
        .cancel(f.session.id, { reason: 'Cancelar carrera QR' }, adminId),
      attendance.markPresent(f.session.id, f.student.id, a.challenge),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const current = await prisma.classSession.findUniqueOrThrow({
      where: { id: f.session.id },
    });
    expect(
      await prisma.attendance.count({
        where: { classSessionId: f.session.id },
      }),
    ).toBe(current.status === 'CANCELLED' ? 0 : 1);
    const cancelled = await qrFixture(prisma);
    const token = await issue(cancelled.session.id);
    await app
      .get(ClassSessionsService)
      .cancel(cancelled.session.id, { reason: 'Revocar QR vigente' }, adminId);
    expect(
      await prisma.attendanceChallenge.count({
        where: { classSessionId: cancelled.session.id, revokedAt: null },
      }),
    ).toBe(0);
    await expect(
      attendance.markPresent(
        cancelled.session.id,
        cancelled.student.id,
        token.challenge,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(issue(cancelled.session.id)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('expires at closeAt and rejects before window, after window and COMPLETED', async () => {
    const f = await qrFixture(prisma);
    clock.set(new Date('2035-01-10T11:59:59.999Z'));
    await expect(issue(f.session.id)).rejects.toMatchObject({ status: 409 });
    clock.set(new Date('2035-01-10T14:59:50Z'));
    const a = await issue(f.session.id);
    expect(a.expiresAt).toEqual(new Date('2035-01-10T15:00:00Z'));
    clock.set(a.expiresAt);
    await expect(issue(f.session.id)).rejects.toMatchObject({ status: 409 });
    await expect(
      attendance.markPresent(f.session.id, f.student.id, a.challenge),
    ).rejects.toMatchObject({ status: 409 });
    await prisma.classSession.update({
      where: { id: f.session.id },
      data: { status: 'COMPLETED', attendanceClosedAt: clock.now() },
    });
    clock.set(QR_NOW);
    await expect(issue(f.session.id)).rejects.toMatchObject({ status: 409 });
  });

  it('does not let a valid QR bypass ownership, current activity or historical eligibility', async () => {
    const f = await qrFixture(prisma),
      foreign = await qrFixture(prisma);
    const a = await issue(f.session.id);
    await expect(
      attendance.markPresent(f.session.id, foreign.student.id, a.challenge),
    ).rejects.toMatchObject({ status: 404 });
    await app.get(StudentsService).deactivate(f.student.id, adminId);
    await expect(
      attendance.markPresent(f.session.id, f.student.id, a.challenge),
    ).rejects.toMatchObject({ status: 401 });
    clock.set(new Date(QR_NOW.getTime() + 1000));
    await app.get(StudentsService).reactivate(f.student.id, adminId);
    await expect(
      attendance.markPresent(f.session.id, f.student.id, a.challenge),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('uses the current attendance window after an Admin changes the class time', async () => {
    const f = await qrFixture(prisma);
    const a = await issue(f.session.id);
    await app.get(ClassSessionsService).updateTime(
      f.session.id,
      {
        startAt: '2035-01-10T11:00:00.000Z',
        endAt: '2035-01-10T12:00:10.000Z',
      },
      adminId,
    );
    clock.set(new Date('2035-01-10T13:00:10.000Z'));
    expect(a.expiresAt > clock.now()).toBe(true);
    await expect(
      attendance.markPresent(f.session.id, f.student.id, a.challenge),
    ).rejects.toMatchObject({ status: 409 });
    await expect(issue(f.session.id)).rejects.toMatchObject({ status: 409 });
    expect(
      await prisma.attendance.count({
        where: { classSessionId: f.session.id },
      }),
    ).toBe(0);
  });

  it('rechecks expiry after a real PostgreSQL row-lock wait inside PRESENT', async () => {
    const f = await qrFixture(prisma);
    const a = await issue(f.session.id);
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Student" WHERE "id" = ${f.student.id} FOR UPDATE`,
        );
        locked();
        await gate;
      },
      { timeout: 10000 },
    );
    await ready;
    const marking = attendance.markPresent(
      f.session.id,
      f.student.id,
      a.challenge,
    );
    // Attach the rejection handler before releasing the transaction.
    const outcome = marking.then(
      () => 'accepted',
      (error) => (error as { status: number }).status,
    );
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await prisma.$queryRaw<{ waiting: boolean }[]>(Prisma.sql`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%FROM "Student"%FOR UPDATE%') AS waiting`);
        if (rows[0].waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      clock.set(a.expiresAt);
    } finally {
      release();
      await blocker;
    }
    expect(await outcome).toBe(409);
    expect(
      await prisma.attendance.count({
        where: { classSessionId: f.session.id },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'ATTENDANCE_PRESENT_RECORDED',
          metadata: { path: ['classSessionId'], equals: f.session.id },
        },
      }),
    ).toBe(0);
  });
});
