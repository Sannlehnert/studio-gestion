import { apiFailure, ErrorCode } from '../common/http/error-code';
import { correctionReason } from './attendance-correction-domain';
import { ParticipationOrigin } from '../class-sessions/class-participation.service';
import { consumesAllowance } from '../recoveries/recovery-domain';
import { AttendanceChallengeService } from './attendance-challenge.service';
import {
  assertChallengeFormat,
  assertChallengeValid,
} from './attendance-challenge';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AttendanceSource,
  AttendanceStatus,
  ClassSessionStatus,
  Prisma,
} from '@prisma/client';
import { ClassSessionsService } from '../class-sessions/class-sessions.service';
import { getSettings } from '../config/env.validation';
import { PrismaService } from '../prisma.service';
import { StudentStatusHistoryService } from '../students/student-status-history.service';
import { databaseDateToLocalDate } from '../time/business-time';
import { CLOCK, Clock } from '../time/clock';
import {
  AdminAttendanceItemState,
  UpcomingClassSessionsQueryDto,
} from './dto/attendance.dto';
import {
  AttendanceWindowStatus,
  attendanceWindow,
  classAllowanceSummary,
} from './attendance-domain';

const attendanceProjection = {
  id: true,
  studentId: true,
  subscriptionId: true,
  classSessionId: true,
  status: true,
  originalStatus: true,
  source: true,
  recordedAt: true,
  recoveryId: true,
} satisfies Prisma.AttendanceSelect;

type AttendanceView = Prisma.AttendanceGetPayload<{
  select: typeof attendanceProjection;
}>;

type SessionForAttendance = {
  id: string;
  scheduleId: string;
  occurrenceDate: Date;
  startAt: Date;
  endAt: Date;
  status: ClassSessionStatus;
  attendanceClosedAt: Date | null;
};

type UpcomingRow = SessionForAttendance;

@Injectable()
export class AttendanceService {
  private readonly openBeforeMinutes: number;
  private readonly closeAfterMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly challenges: AttendanceChallengeService,
    private readonly classSessions: ClassSessionsService,
    config: ConfigService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly studentStatusHistory: StudentStatusHistoryService,
  ) {
    const settings = getSettings(config);
    this.openBeforeMinutes = settings.attendanceOpenBeforeMinutes;
    this.closeAfterMinutes = settings.attendanceCloseAfterMinutes;
  }

  async markPresent(
    classSessionId: string,
    studentId: string,
    challenge: string,
  ) {
    assertChallengeFormat(challenge);
    return this.recordPresent(classSessionId, studentId, {
      type: 'STUDENT',
      challenge,
    });
  }

  async markManualPresent(
    classSessionId: string,
    studentId: string,
    reason: string,
    adminId: string,
  ) {
    return this.recordPresent(classSessionId, studentId, {
      type: 'ADMIN',
      adminId,
      reason: correctionReason(reason),
    });
  }

  private async recordPresent(
    classSessionId: string,
    studentId: string,
    actor:
      | { type: 'STUDENT'; challenge: string }
      | { type: 'ADMIN'; adminId: string; reason: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockClassSession(tx, classSessionId);
      const session = await this.findSession(tx, classSessionId);
      if (!session) throw new NotFoundException('Clase no encontrada');

      const existing = await tx.attendance.findUnique({
        where: { studentId_classSessionId: { studentId, classSessionId } },
        select: attendanceProjection,
      });
      if (actor.type === 'ADMIN' && existing) {
        throw new ConflictException(
          apiFailure(
            ErrorCode.ATTENDANCE_ALREADY_RECORDED,
            'La asistencia ya existe; utilizá una corrección administrativa',
          ),
        );
      }
      if (existing?.status === AttendanceStatus.ABSENT) {
        throw new ConflictException(
          apiFailure(
            ErrorCode.ATTENDANCE_ALREADY_RECORDED,
            'La clase ya fue cerrada con ausencia para la alumna',
          ),
        );
      }
      if (session.status === ClassSessionStatus.CANCELLED) {
        throw new ConflictException(
          apiFailure(
            ErrorCode.ATTENDANCE_INELIGIBLE,
            'La clase está cancelada',
          ),
        );
      }
      if (session.status === ClassSessionStatus.COMPLETED) {
        throw new ConflictException(
          apiFailure(
            ErrorCode.ATTENDANCE_WINDOW_CLOSED,
            actor.type === 'ADMIN' && !existing
              ? 'Anomalía de integridad: clase cerrada sin asistencia; requiere revisión administrativa'
              : 'La asistencia de la clase ya fue cerrada',
          ),
        );
      }

      const initialWindow = this.window(session, this.clock.now());
      if (initialWindow.status !== AttendanceWindowStatus.OPEN) {
        throw new ConflictException(
          apiFailure(
            initialWindow.status === AttendanceWindowStatus.UPCOMING
              ? ErrorCode.ATTENDANCE_TOO_EARLY
              : ErrorCode.ATTENDANCE_WINDOW_CLOSED,
            initialWindow.status === AttendanceWindowStatus.UPCOMING
              ? 'La ventana de asistencia todavía no abrió'
              : 'La ventana de asistencia ya cerró',
          ),
        );
      }

      const qr =
        actor.type === 'STUDENT'
          ? await this.challenges.find(tx, actor.challenge)
          : null;
      if (actor.type === 'STUDENT')
        assertChallengeValid(qr, classSessionId, this.clock.now());

      await this.lockStudents(tx, [studentId]);
      const student = await tx.student.findUnique({
        where: { id: studentId },
        select: { id: true, isActive: true },
      });
      if (!student?.isActive) {
        if (actor.type === 'ADMIN')
          throw new ConflictException(
            apiFailure(ErrorCode.ATTENDANCE_INELIGIBLE, 'Alumna no disponible'),
          );
        throw new UnauthorizedException('Alumna no disponible');
      }

      const expectedBeforeLock = (
        await this.classSessions.findExpectedRecords(tx, session)
      ).find((item) => item.student.id === studentId);
      if (!expectedBeforeLock) {
        throw new NotFoundException('Clase no disponible para la alumna');
      }
      await this.lockSubscriptions(tx, [expectedBeforeLock.subscriptionId]);
      const expected = (
        await this.classSessions.findExpectedRecords(tx, session)
      ).find((item) => item.student.id === studentId);
      if (!expected) {
        throw new ConflictException(
          apiFailure(
            ErrorCode.ATTENDANCE_INELIGIBLE,
            'La suscripción no habilita asistencia para esta clase',
          ),
        );
      }

      const summary = await this.classSummaryTx(
        tx,
        expected.subscriptionId,
        studentId,
      );
      const recordedAt = this.clock.now();
      const finalWindow = this.window(session, recordedAt);
      if (finalWindow.status !== AttendanceWindowStatus.OPEN) {
        throw new ConflictException(
          apiFailure(
            finalWindow.status === AttendanceWindowStatus.UPCOMING
              ? ErrorCode.ATTENDANCE_TOO_EARLY
              : ErrorCode.ATTENDANCE_WINDOW_CLOSED,
            finalWindow.status === AttendanceWindowStatus.UPCOMING
              ? 'La ventana de asistencia todavía no abrió'
              : 'La ventana de asistencia ya cerró',
          ),
        );
      }

      if (actor.type === 'STUDENT')
        assertChallengeValid(qr, classSessionId, recordedAt);
      if (existing?.status === AttendanceStatus.PRESENT) {
        return {
          classSession: {
            id: session.id,
            occurrenceDate: databaseDateToLocalDate(session.occurrenceDate),
            startAt: session.startAt,
            endAt: session.endAt,
          },
          window: finalWindow,
          origin: existing.recoveryId
            ? ParticipationOrigin.RECOVERY
            : ParticipationOrigin.ENROLLMENT,
          recoveryId: existing.recoveryId,
          attendance: {
            ...existing,
            consumesAllowance: consumesAllowance(existing.recoveryId),
          },
          classSummary: summary,
        };
      }
      if (expected.recoveryId === null && summary.remainingClasses === 0) {
        throw new ConflictException(
          apiFailure(
            ErrorCode.ALLOWANCE_EXHAUSTED,
            'La suscripción agotó sus clases',
          ),
        );
      }
      const attendance = await tx.attendance.create({
        data: {
          studentId,
          subscriptionId: expected.subscriptionId,
          classSessionId,
          recoveryId: expected.recoveryId,
          status: AttendanceStatus.PRESENT,
          originalStatus: AttendanceStatus.PRESENT,
          source:
            actor.type === 'ADMIN'
              ? AttendanceSource.ADMIN
              : AttendanceSource.STUDENT,
          ...(actor.type === 'ADMIN'
            ? { createdByAdminId: actor.adminId, creationReason: actor.reason }
            : {}),
          recordedAt,
        },
        select: attendanceProjection,
      });
      await tx.auditLog.create({
        data: {
          actorType: actor.type,
          actorId: actor.type === 'ADMIN' ? actor.adminId : studentId,
          action:
            actor.type === 'ADMIN'
              ? 'ATTENDANCE_MANUAL_PRESENT_RECORDED'
              : 'ATTENDANCE_PRESENT_RECORDED',
          entity: 'Attendance',
          entityId: attendance.id,
          metadata: {
            classSessionId,
            subscriptionId: expected.subscriptionId,
            ...(actor.type === 'ADMIN'
              ? { studentId, reason: actor.reason }
              : {}),
          },
        },
      });
      const response = await this.studentResponse(tx, session, attendance);
      const finishedAt = this.clock.now();
      if (actor.type === 'STUDENT')
        assertChallengeValid(qr, classSessionId, finishedAt);
      if (
        this.window(session, finishedAt).status !== AttendanceWindowStatus.OPEN
      ) {
        throw new ConflictException(
          apiFailure(
            ErrorCode.ATTENDANCE_WINDOW_CLOSED,
            'La ventana de asistencia ya cerró',
          ),
        );
      }
      return response;
    });
  }

  async getStudentAttendance(classSessionId: string, studentId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const session = await this.findSession(tx, classSessionId);
        if (!session) throw new NotFoundException('Clase no encontrada');
        const attendance = await tx.attendance.findUnique({
          where: { studentId_classSessionId: { studentId, classSessionId } },
          select: attendanceProjection,
        });
        const expected = (
          await this.classSessions.findExpectedRecords(tx, session)
        ).find((item) => item.student.id === studentId);
        if (!attendance && !expected) {
          throw new NotFoundException('Clase no disponible para la alumna');
        }
        const subscriptionId =
          attendance?.subscriptionId ?? expected!.subscriptionId;
        return this.studentResponse(
          tx,
          session,
          attendance,
          subscriptionId,
          undefined,
          attendance?.recoveryId ?? expected?.recoveryId ?? null,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async upcoming(studentId: string, query: UpcomingClassSessionsQueryDto) {
    const now = this.clock.now();
    return this.prisma.$transaction(
      async (tx) => {
        const items = [];
        const batchSize = Math.max(query.limit, 50);
        let cursor: { startAt: Date; id: string } | undefined;
        while (items.length < query.limit) {
          const rows = await tx.$queryRaw<UpcomingRow[]>(Prisma.sql`
            SELECT cs."id", cs."scheduleId", cs."occurrenceDate", cs."startAt",
              cs."endAt", cs."status", cs."attendanceClosedAt"
            FROM "ClassSession" cs
            WHERE cs."status" = 'SCHEDULED'
              AND cs."endAt" + (${this.closeAfterMinutes} * INTERVAL '1 minute') > ${now}
              AND (
                EXISTS (SELECT 1 FROM "Enrollment" e JOIN "Subscription" s ON s."id" = e."subscriptionId"
                  WHERE e."studentId" = ${studentId} AND e."scheduleId" = cs."scheduleId"
                    AND e."validFrom" <= cs."occurrenceDate" AND e."validUntil" > cs."occurrenceDate"
                    AND s."periodStart" <= cs."startAt" AND s."periodEnd" > cs."startAt"
                    AND (s."status" = 'ACTIVE' OR (s."status" = 'CANCELLED' AND s."cancelledAt" > cs."startAt")))
                OR EXISTS (SELECT 1 FROM "Recovery" r JOIN "Subscription" s ON s."id" = r."subscriptionId"
                  WHERE r."studentId" = ${studentId} AND r."recoverySessionId" = cs."id" AND r."cancelledAt" IS NULL
                    AND s."periodStart" <= cs."startAt" AND s."periodEnd" > cs."startAt"
                    AND (s."status" = 'ACTIVE' OR (s."status" = 'CANCELLED' AND s."cancelledAt" > cs."startAt")))
              )
              ${
                cursor
                  ? Prisma.sql`AND (cs."startAt", cs."id") > (${cursor.startAt}, ${cursor.id})`
                  : Prisma.empty
              }
            ORDER BY cs."startAt" ASC, cs."id" ASC
            LIMIT ${batchSize}
          `);
          if (rows.length === 0) break;
          const last = rows[rows.length - 1];
          cursor = { startAt: last.startAt, id: last.id };
          for (const row of rows) {
            if (
              !(await this.studentStatusHistory.wasActiveAt(
                tx,
                studentId,
                row.startAt,
              ))
            ) {
              continue;
            }
            const expected = (
              await this.classSessions.findExpectedRecords(tx, row)
            ).find((item) => item.student.id === studentId);
            if (!expected) continue;
            const attendance = await tx.attendance.findUnique({
              where: {
                studentId_classSessionId: {
                  studentId,
                  classSessionId: row.id,
                },
              },
              select: attendanceProjection,
            });
            items.push(
              await this.studentResponse(
                tx,
                row,
                attendance,
                expected.subscriptionId,
                now,
                attendance?.recoveryId ?? expected.recoveryId,
              ),
            );
            if (items.length === query.limit) break;
          }
          if (rows.length < batchSize) break;
        }
        return { items };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async getClassSummary(subscriptionId: string, studentId?: string) {
    return this.prisma.$transaction(
      (tx) => this.classSummaryTx(tx, subscriptionId, studentId),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async getAdminClassAttendance(classSessionId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const session = await this.findSession(tx, classSessionId);
        if (!session) throw new NotFoundException('Clase no encontrada');
        if (session.status === ClassSessionStatus.CANCELLED) {
          return {
            classSessionId,
            attendanceRequired: false,
            window: this.window(session, this.clock.now()),
            totals: {
              expected: 0,
              present: 0,
              absent: 0,
              pending: 0,
              unresolved: 0,
              notRequiredInactive: 0,
            },
            items: [],
          };
        }
        const expected = await this.classSessions.findExpectedRecords(
          tx,
          session,
        );
        const records = await tx.attendance.findMany({
          where: { classSessionId },
          select: attendanceProjection,
        });
        const byStudent = new Map(
          records.map((record) => [record.studentId, record]),
        );
        const window = this.window(session, this.clock.now());
        const items = expected.map((item) => {
          const attendance = byStudent.get(item.student.id) ?? null;
          const state = attendance
            ? attendance.status === AttendanceStatus.PRESENT
              ? AdminAttendanceItemState.PRESENT
              : AdminAttendanceItemState.ABSENT
            : window.status === AttendanceWindowStatus.UPCOMING ||
                window.status === AttendanceWindowStatus.OPEN
              ? AdminAttendanceItemState.PENDING
              : AdminAttendanceItemState.UNRESOLVED;
          return {
            studentId: item.student.id,
            fullName: item.student.fullName,
            subscriptionId: item.subscriptionId,
            origin: item.origin,
            recoveryId: item.recoveryId,
            state,
            attendance: attendance
              ? {
                  ...attendance,
                  consumesAllowance: consumesAllowance(attendance.recoveryId),
                }
              : null,
          };
        });
        const total = (state: AdminAttendanceItemState) =>
          items.filter((item) => item.state === state).length;
        return {
          classSessionId,
          attendanceRequired: true,
          window,
          totals: {
            expected: expected.length,
            present: total(AdminAttendanceItemState.PRESENT),
            absent: total(AdminAttendanceItemState.ABSENT),
            pending: total(AdminAttendanceItemState.PENDING),
            unresolved: total(AdminAttendanceItemState.UNRESOLVED),
            notRequiredInactive: total(
              AdminAttendanceItemState.NOT_REQUIRED_INACTIVE,
            ),
          },
          items,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async reconcileDue(now = this.clock.now(), limit = 100) {
    const cutoff = new Date(now.getTime() - this.closeAfterMinutes * 60_000);
    const sessions = await this.prisma.classSession.findMany({
      where: {
        status: ClassSessionStatus.SCHEDULED,
        attendanceClosedAt: null,
        endAt: { lte: cutoff },
      },
      select: { id: true },
      orderBy: [{ endAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    const result = {
      candidates: sessions.length,
      completed: 0,
      absencesCreated: 0,
      unresolvedAllowance: 0,
    };
    for (const session of sessions) {
      const item = await this.reconcileClassSession(session.id, now);
      result.completed += item.completed ? 1 : 0;
      result.absencesCreated += item.absencesCreated;
      result.unresolvedAllowance += item.unresolvedAllowance;
    }
    return result;
  }

  private async reconcileClassSession(classSessionId: string, now: Date) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockClassSession(tx, classSessionId);
      let session = await this.findSession(tx, classSessionId);
      if (
        !session ||
        session.status !== ClassSessionStatus.SCHEDULED ||
        this.window(session, now).status !== AttendanceWindowStatus.CLOSED
      ) {
        return {
          completed: false,
          absencesCreated: 0,
          unresolvedAllowance: 0,
        };
      }

      let expected = await this.classSessions.findExpectedRecords(tx, session);
      await this.lockStudents(
        tx,
        expected.map((item) => item.student.id),
      );
      await this.lockSubscriptions(
        tx,
        expected.map((item) => item.subscriptionId),
      );
      session = (await this.findSession(tx, classSessionId))!;
      expected = await this.classSessions.findExpectedRecords(tx, session);
      const existing = await tx.attendance.findMany({
        where: { classSessionId },
        select: { studentId: true },
      });
      const existingStudents = new Set(existing.map((item) => item.studentId));
      const subscriptions = await tx.subscription.findMany({
        where: {
          id: { in: expected.map((item) => item.subscriptionId) },
        },
        select: { id: true, classAllowance: true },
      });
      const allowances = new Map(
        subscriptions.map((item) => [item.id, item.classAllowance]),
      );
      const usedRows = await tx.attendance.groupBy({
        by: ['subscriptionId'],
        where: {
          subscriptionId: { in: [...allowances.keys()] },
          recoveryId: null,
        },
        _count: { _all: true },
      });
      const used = new Map(
        usedRows.map((item) => [item.subscriptionId, item._count._all]),
      );
      let absencesCreated = 0;
      let unresolvedAllowance = 0;
      for (const item of expected) {
        if (existingStudents.has(item.student.id)) continue;
        const current = used.get(item.subscriptionId) ?? 0;
        const allowance = allowances.get(item.subscriptionId) ?? 0;
        if (item.recoveryId === null && current >= allowance) {
          unresolvedAllowance += 1;
          continue;
        }
        await tx.attendance.create({
          data: {
            studentId: item.student.id,
            subscriptionId: item.subscriptionId,
            classSessionId,
            recoveryId: item.recoveryId,
            status: AttendanceStatus.ABSENT,
            originalStatus: AttendanceStatus.ABSENT,
            source: AttendanceSource.SYSTEM,
            recordedAt: now,
          },
        });
        existingStudents.add(item.student.id);
        if (item.recoveryId === null)
          used.set(item.subscriptionId, current + 1);
        absencesCreated += 1;
      }

      const completed = unresolvedAllowance === 0;
      if (completed) {
        await tx.classSession.update({
          where: { id: classSessionId },
          data: {
            status: ClassSessionStatus.COMPLETED,
            attendanceClosedAt: now,
          },
        });
      }
      if (absencesCreated > 0 || completed) {
        await tx.auditLog.create({
          data: {
            actorType: 'SYSTEM',
            actorId: null,
            action: 'CLASS_SESSION_ATTENDANCE_RECONCILED',
            entity: 'ClassSession',
            entityId: classSessionId,
            metadata: {
              absencesCreated,
              historicallyEligible: expected.length,
              unresolvedAllowance,
              completed,
            },
          },
        });
      }
      return { completed, absencesCreated, unresolvedAllowance };
    });
  }

  private async studentResponse(
    tx: Prisma.TransactionClient,
    session: SessionForAttendance,
    attendance: AttendanceView | null,
    subscriptionId = attendance?.subscriptionId,
    now = this.clock.now(),
    recoveryId: string | null = attendance?.recoveryId ?? null,
  ) {
    if (!subscriptionId) {
      throw new NotFoundException('Suscripción de asistencia no encontrada');
    }
    return {
      classSession: {
        id: session.id,
        occurrenceDate: databaseDateToLocalDate(session.occurrenceDate),
        startAt: session.startAt,
        endAt: session.endAt,
      },
      window: this.window(session, now),
      origin: recoveryId
        ? ParticipationOrigin.RECOVERY
        : ParticipationOrigin.ENROLLMENT,
      recoveryId,
      attendance: attendance
        ? {
            ...attendance,
            consumesAllowance: consumesAllowance(attendance.recoveryId),
          }
        : null,
      classSummary: await this.classSummaryTx(tx, subscriptionId),
    };
  }

  private async classSummaryTx(
    tx: Prisma.TransactionClient,
    subscriptionId: string,
    studentId?: string,
  ) {
    const subscription = await tx.subscription.findFirst({
      where: { id: subscriptionId, ...(studentId ? { studentId } : {}) },
      select: { id: true, classAllowance: true },
    });
    if (!subscription) throw new NotFoundException('Suscripción no encontrada');
    const usedClasses = await tx.attendance.count({
      where: { subscriptionId, recoveryId: null },
    });
    return {
      subscriptionId,
      ...classAllowanceSummary(subscription.classAllowance, usedClasses),
    };
  }

  private window(session: SessionForAttendance, now: Date) {
    return attendanceWindow(
      session,
      now,
      this.openBeforeMinutes,
      this.closeAfterMinutes,
    );
  }

  private findSession(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<SessionForAttendance | null> {
    return tx.classSession.findUnique({
      where: { id },
      select: {
        id: true,
        scheduleId: true,
        occurrenceDate: true,
        startAt: true,
        endAt: true,
        status: true,
        attendanceClosedAt: true,
      },
    });
  }

  private async lockClassSession(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "ClassSession" WHERE "id" = ${id} FOR UPDATE`,
    );
  }

  private async lockStudents(
    tx: Prisma.TransactionClient,
    studentIds: string[],
  ) {
    for (const id of [...new Set(studentIds)].sort()) {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Student" WHERE "id" = ${id} FOR UPDATE`,
      );
    }
  }

  private async lockSubscriptions(
    tx: Prisma.TransactionClient,
    subscriptionIds: string[],
  ) {
    for (const id of [...new Set(subscriptionIds)].sort()) {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Subscription" WHERE "id" = ${id} FOR UPDATE`,
      );
    }
  }
}
