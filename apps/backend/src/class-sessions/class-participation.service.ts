import { Injectable } from '@nestjs/common';
import { Prisma, ClassSessionStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { StudentStatusHistoryService } from '../students/student-status-history.service';

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
    if (session.status === ClassSessionStatus.CANCELLED)
      return new Set<string>();
    const normal = await this.normal(client, session, false);
    const recovery = await this.recoveries(client, session, false);
    return new Set([...normal, ...recovery].map((row) => row.student.id));
  }
}
