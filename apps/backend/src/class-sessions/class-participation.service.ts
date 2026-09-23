import { Injectable } from '@nestjs/common';
import { Prisma, ClassSessionStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { StudentStatusHistoryService } from '../students/student-status-history.service';
import { wasActiveAt } from '../students/student-status-history';
import { subscriptionCoversRecovery } from '../recoveries/recovery-domain';

export type ParticipationSession = {
  id: string;
  scheduleId: string;
  occurrenceDate: Date;
  startAt: Date;
};
export enum ParticipationOrigin {
  ENROLLMENT = 'ENROLLMENT',
  RECOVERY = 'RECOVERY',
}
export type Participation = {
  enrollmentId: string | null;
  recoveryId: string | null;
  origin: ParticipationOrigin;
  subscriptionId: string;
  student: { id: string; fullName: string };
};

// Shared derivation, not another persistence layer. Capacity intentionally retains
// contractual normal reservations even if a Student is currently inactive.
@Injectable()
export class ClassParticipationService {
  constructor(private readonly history: StudentStatusHistoryService) {}
  normal(
    client: Prisma.TransactionClient | PrismaService,
    session: ParticipationSession,
    historical = true,
  ) {
    return client.enrollment.findMany({
      where: {
        scheduleId: session.scheduleId,
        validFrom: { lte: session.occurrenceDate },
        validUntil: { gt: session.occurrenceDate },
        subscription: {
          periodStart: { lte: session.startAt },
          periodEnd: { gt: session.startAt },
          OR: [
            { status: 'ACTIVE' },
            { status: 'CANCELLED', cancelledAt: { gt: session.startAt } },
          ],
        },
        ...(historical
          ? { student: this.history.activeAtWhere(session.startAt) }
          : {}),
      },
      select: {
        id: true,
        subscriptionId: true,
        student: { select: { id: true, fullName: true } },
      },
      orderBy: [{ student: { fullName: 'asc' } }, { id: 'asc' }],
    });
  }
  async recoveries(
    client: Prisma.TransactionClient | PrismaService,
    session: ParticipationSession,
    historical = true,
  ) {
    const rows = await client.recovery.findMany({
      where: {
        recoverySessionId: session.id,
        cancelledAt: null,
        ...(historical
          ? { student: this.history.activeAtWhere(session.startAt) }
          : {}),
        subscription: {
          periodStart: { lte: session.startAt },
          periodEnd: { gt: session.startAt },
          OR: [
            { status: 'ACTIVE' },
            { status: 'CANCELLED', cancelledAt: { gt: session.startAt } },
          ],
        },
      },
      select: {
        id: true,
        subscriptionId: true,
        student: { select: { id: true, fullName: true } },
      },
      orderBy: { id: 'asc' },
    });
    return rows;
  }
  async expected(
    client: Prisma.TransactionClient | PrismaService,
    session: ParticipationSession,
  ): Promise<Participation[]> {
    const normal = await this.normal(client, session);
    const recovery = await this.recoveries(client, session);
    // Normal enrollment wins as a defensive fallback: never turn an ordinary
    // consuming class into a free one. Mutation paths reject this coexistence.
    const byStudent = new Map<string, Participation>(
      normal.map((row) => [
        row.student.id,
        {
          enrollmentId: row.id,
          recoveryId: null,
          origin: ParticipationOrigin.ENROLLMENT,
          subscriptionId: row.subscriptionId,
          student: row.student,
        },
      ]),
    );
    for (const row of recovery)
      if (!byStudent.has(row.student.id))
        byStudent.set(row.student.id, {
          enrollmentId: null,
          recoveryId: row.id,
          origin: ParticipationOrigin.RECOVERY,
          subscriptionId: row.subscriptionId,
          student: row.student,
        });
    return [...byStudent.values()].sort(
      (a, b) =>
        a.student.fullName.localeCompare(b.student.fullName) ||
        a.student.id.localeCompare(b.student.id),
    );
  }
  async reservations(
    client: Prisma.TransactionClient,
    session: ParticipationSession & { status: ClassSessionStatus },
  ) {
    return new Set(
      (await this.forSessions(client, [session], false))
        .get(session.id)
        ?.map((row) => row.student.id),
    );
  }

  /** Bounded batch read shared with capacity mutations. Inactivity never releases reservations. */
  async forSessions(
    client: Prisma.TransactionClient,
    sessions: (ParticipationSession & { status: ClassSessionStatus })[],
    historical: boolean,
    studentId?: string,
  ): Promise<Map<string, Participation[]>> {
    const result = new Map<string, Participation[]>(
      sessions.map((s) => [s.id, []]),
    );
    const active = sessions.filter((s) => s.status !== 'CANCELLED');
    if (!active.length) return result;
    const student = {
      select: {
        id: true,
        fullName: true,
        activePeriods: { select: { validFrom: true, validUntil: true } },
      },
    } as const;
    const subscription = {
      select: {
        status: true,
        periodStart: true,
        periodEnd: true,
        cancelledAt: true,
      },
    } as const;
    const normal = await client.enrollment.findMany({
      where: {
        ...(studentId ? { studentId } : {}),
        OR: active.map((s) => ({
          scheduleId: s.scheduleId,
          validFrom: { lte: s.occurrenceDate },
          validUntil: { gt: s.occurrenceDate },
        })),
      },
      select: {
        id: true,
        scheduleId: true,
        validFrom: true,
        validUntil: true,
        subscriptionId: true,
        subscription,
        student,
      },
      orderBy: { id: 'asc' },
    });
    const recoveries = await client.recovery.findMany({
      where: {
        ...(studentId ? { studentId } : {}),
        recoverySessionId: { in: active.map((s) => s.id) },
        cancelledAt: null,
      },
      select: {
        id: true,
        recoverySessionId: true,
        subscriptionId: true,
        subscription,
        student,
      },
      orderBy: { id: 'asc' },
    });
    for (const s of active) {
      const byStudent = new Map<string, Participation>();
      for (const row of normal) {
        if (
          row.scheduleId !== s.scheduleId ||
          row.validFrom > s.occurrenceDate ||
          row.validUntil <= s.occurrenceDate ||
          !subscriptionCoversRecovery(row.subscription, s.startAt) ||
          (historical && !wasActiveAt(row.student.activePeriods, s.startAt))
        )
          continue;
        byStudent.set(row.student.id, {
          enrollmentId: row.id,
          recoveryId: null,
          origin: ParticipationOrigin.ENROLLMENT,
          subscriptionId: row.subscriptionId,
          student: { id: row.student.id, fullName: row.student.fullName },
        });
      }
      for (const row of recoveries) {
        if (
          row.recoverySessionId !== s.id ||
          byStudent.has(row.student.id) ||
          !subscriptionCoversRecovery(row.subscription, s.startAt) ||
          (historical && !wasActiveAt(row.student.activePeriods, s.startAt))
        )
          continue;
        byStudent.set(row.student.id, {
          enrollmentId: null,
          recoveryId: row.id,
          origin: ParticipationOrigin.RECOVERY,
          subscriptionId: row.subscriptionId,
          student: { id: row.student.id, fullName: row.student.fullName },
        });
      }
      result.set(
        s.id,
        [...byStudent.values()].sort(
          (a, b) =>
            a.student.fullName.localeCompare(b.student.fullName) ||
            a.student.id.localeCompare(b.student.id),
        ),
      );
    }
    return result;
  }
}
