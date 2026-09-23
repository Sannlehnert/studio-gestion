import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CLOCK, Clock } from '../time/clock';
import { BusinessTimeService } from '../time/business-time.service';
import {
  addLocalDays,
  databaseDateToLocalDate,
  localDateToDatabaseDate,
  localDatesInclusive,
  parseLocalDate,
} from '../time/business-time';
import {
  attendanceWindow,
  classAllowanceSummary,
} from '../attendance/attendance-domain';
import { ClassParticipationService } from '../class-sessions/class-participation.service';
import { calculateFinancialSummary } from '../commercial/commercial-domain';
import { wasActiveAt } from '../students/student-status-history';
import {
  recoverableAbsence,
  subscriptionCoversRecovery,
} from '../recoveries/recovery-domain';
import { getSettings } from '../config/env.validation';
import { apiFailure, ErrorCode } from '../common/http/error-code';
import {
  HistoryQueryDto,
  ParticipationKind,
  ReadQueryDto,
  SubscriptionContext,
  UpcomingReadItemDto,
} from './integration.dto';

const classSelect = {
  id: true,
  occurrenceDate: true,
  startAt: true,
  endAt: true,
  status: true,
} as const;
const historySelect = {
  id: true,
  classSessionId: true,
  status: true,
  recoveryId: true,
  classSession: { select: classSelect },
  corrections: { select: { id: true }, take: 1 },
  recovery: {
    select: {
      id: true,
      originalAbsence: { select: { classSession: { select: classSelect } } },
    },
  },
} satisfies Prisma.AttendanceSelect;
type HistoryRow = Prisma.AttendanceGetPayload<{ select: typeof historySelect }>;
type ReadClass = Prisma.ClassSessionGetPayload<{ select: typeof classSelect }>;

export function readClass(row: ReadClass) {
  return {
    classSessionId: row.id,
    occurrenceDate: databaseDateToLocalDate(row.occurrenceDate),
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
  };
}
export function historyItem(row: HistoryRow) {
  return {
    attendanceId: row.id,
    classSession: readClass(row.classSession),
    effectiveStatus: row.status,
    participationKind: row.recoveryId
      ? ParticipationKind.RECOVERY
      : ParticipationKind.REGULAR,
    corrected: row.corrections.length > 0,
    recovery: row.recovery
      ? {
          recoveryId: row.recovery.id,
          originalClass: readClass(row.recovery.originalAbsence.classSession),
        }
      : null,
  };
}
export function subscriptionContext(
  subscription: { periodStart: Date } | null,
  now: Date,
) {
  return subscription
    ? subscription.periodStart <= now
      ? SubscriptionContext.CURRENT
      : SubscriptionContext.UPCOMING
    : SubscriptionContext.NONE;
}
export function availableCapacity(capacity: number, occupied: number) {
  return Math.max(0, capacity - occupied);
}
function meta(query: { page: number; limit: number }, total: number) {
  return {
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit),
  };
}

@Injectable()
export class IntegrationReadsService {
  private readonly settings;
  constructor(
    private readonly prisma: PrismaService,
    private readonly participation: ClassParticipationService,
    private readonly time: BusinessTimeService,
    config: ConfigService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.settings = getSettings(config);
  }
  private context(now: Date) {
    return {
      readAt: now,
      businessDate: this.time.today(now),
      timeZone: this.time.timeZone,
    };
  }
  private async student(tx: Prisma.TransactionClient, id: string) {
    const student = await tx.student.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Alumna no encontrada');
  }
  private range(query: ReadQueryDto) {
    try {
      if (query.dateFrom) parseLocalDate(query.dateFrom);
      if (query.dateTo) parseLocalDate(query.dateTo);
      if (query.dateFrom && query.dateTo)
        localDatesInclusive(query.dateFrom, query.dateTo, 366);
    } catch {
      throw new BadRequestException(
        'Rango de fechas inválido; máximo 366 días',
      );
    }
    return {
      ...(query.dateFrom
        ? { gte: localDateToDatabaseDate(query.dateFrom) }
        : {}),
      ...(query.dateTo ? { lte: localDateToDatabaseDate(query.dateTo) } : {}),
    };
  }
  private async summary(
    tx: Prisma.TransactionClient,
    studentId: string,
    now: Date,
    financial: boolean,
  ) {
    await this.student(tx, studentId);
    const subscription = await tx.subscription.findFirst({
      where: { studentId, status: 'ACTIVE', periodEnd: { gt: now } },
      orderBy: [{ periodStart: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        planName: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        classAllowance: true,
        agreedPrice: true,
        currency: true,
      },
    });
    const used = subscription
      ? await tx.attendance.count({
          where: { subscriptionId: subscription.id, recoveryId: null },
        })
      : 0;
    const result = {
      ...this.context(now),
      context: subscriptionContext(subscription, now),
      subscription: subscription
        ? {
            subscriptionId: subscription.id,
            planName: subscription.planName,
            status: subscription.status,
            periodStart: subscription.periodStart,
            periodEnd: subscription.periodEnd,
            ...classAllowanceSummary(subscription.classAllowance, used),
          }
        : null,
    };
    if (!financial) return result;
    const payments = subscription
      ? await tx.payment.findMany({
          where: { subscriptionId: subscription.id },
          select: { amount: true, status: true },
        })
      : [];
    return {
      ...result,
      financialSummary: subscription
        ? calculateFinancialSummary(
            subscription.agreedPrice,
            subscription.currency,
            payments,
          )
        : null,
    };
  }
  adminSummary(studentId: string) {
    const now = this.clock.now();
    return this.prisma.$transaction(
      (tx) => this.summary(tx, studentId, now, true),
      { isolationLevel: 'RepeatableRead' },
    );
  }
  history(studentId: string, query: HistoryQueryDto) {
    const occurrenceDate = this.range(query);
    return this.prisma.$transaction(
      async (tx) => {
        await this.student(tx, studentId);
        const where: Prisma.AttendanceWhereInput = {
          studentId,
          ...(query.effectiveStatus ? { status: query.effectiveStatus } : {}),
          ...(query.dateFrom || query.dateTo
            ? { classSession: { occurrenceDate } }
            : {}),
        };
        const total = await tx.attendance.count({ where });
        const rows = await tx.attendance.findMany({
          where,
          select: historySelect,
          orderBy: [{ classSession: { startAt: 'desc' } }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        });
        return { items: rows.map(historyItem), meta: meta(query, total) };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  private async upcomingTx(
    tx: Prisma.TransactionClient,
    studentId: string,
    now: Date,
    limit: number,
    recoveryOnly = false,
  ): Promise<UpcomingReadItemDto[]> {
    // Query relevant candidates only. All eligibility is then evaluated in a bounded shared batch.
    const rows = await tx.classSession.findMany({
      where: {
        status: 'SCHEDULED',
        endAt: {
          gt: new Date(
            now.getTime() - this.settings.attendanceCloseAfterMinutes * 60000,
          ),
        },
        OR: [
          ...(!recoveryOnly
            ? [{ schedule: { enrollments: { some: { studentId } } } }]
            : []),
          {
            recoveries: {
              some: {
                studentId,
                cancelledAt: null,
                ...(recoveryOnly ? { attendance: null } : {}),
              },
            },
          },
        ],
      },
      include: { schedule: { select: { id: true } } },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      take: 1001,
    });
    this.assertCandidateLimit(rows.length);
    const participation = await this.participation.forSessions(
      tx,
      rows,
      true,
      studentId,
    );
    const records = await tx.attendance.findMany({
      where: { studentId, classSessionId: { in: rows.map((r) => r.id) } },
      select: historySelect,
    });
    const byClass = new Map(records.map((r) => [r.classSessionId, r]));
    const items: UpcomingReadItemDto[] = [];
    for (const row of rows) {
      const p = participation.get(row.id)?.[0];
      if (!p || (recoveryOnly && (!p.recoveryId || byClass.has(row.id))))
        continue;
      items.push({
        classSession: readClass(row),
        participationKind: p.recoveryId
          ? ParticipationKind.RECOVERY
          : ParticipationKind.REGULAR,
        recoveryId: p.recoveryId,
        attendance: byClass.has(row.id)
          ? historyItem(byClass.get(row.id)!)
          : null,
        window: attendanceWindow(
          row,
          now,
          this.settings.attendanceOpenBeforeMinutes,
          this.settings.attendanceCloseAfterMinutes,
        ),
      });
      if (items.length === limit) break;
    }
    return items;
  }
  upcoming(studentId: string, limit: number) {
    const now = this.clock.now();
    return this.prisma.$transaction(
      async (tx) => {
        await this.student(tx, studentId);
        return {
          ...this.context(now),
          items: await this.upcomingTx(tx, studentId, now, limit),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  home(studentId: string) {
    const now = this.clock.now();
    return this.prisma.$transaction(
      async (tx) => {
        const summary = await this.summary(tx, studentId, now, false);
        const nextClass =
          (await this.upcomingTx(tx, studentId, now, 1))[0] ?? null;
        const recovery =
          (await this.upcomingTx(tx, studentId, now, 1, true))[0] ?? null;
        return {
          ...summary,
          nextClass,
          nextRecovery:
            recovery?.classSession.classSessionId ===
            nextClass?.classSession.classSessionId
              ? null
              : recovery,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  private assertCandidateLimit(count: number) {
    if (count > 1000)
      throw new BadRequestException(
        'La consulta supera el máximo de 1000 clases candidatas',
      );
  }
  recoveryOptions(attendanceId: string, query: ReadQueryDto) {
    const now = this.clock.now();
    const dateFrom = query.dateFrom ?? this.time.today(now);
    const dateTo = query.dateTo ?? addLocalDays(dateFrom, 89);
    const range = this.range({ ...query, dateFrom, dateTo });
    return this.prisma.$transaction(
      async (tx) => {
        const original = await tx.attendance.findUnique({
          where: { id: attendanceId },
          include: {
            classSession: true,
            subscription: true,
            student: { include: { activePeriods: true } },
          },
        });
        if (!original) throw new NotFoundException('Asistencia no encontrada');
        if (
          !recoverableAbsence(original, '') ||
          original.classSession.status === 'CANCELLED'
        )
          throw new ConflictException(
            apiFailure(
              ErrorCode.RECOVERY_INVALID,
              'Se requiere una ausencia habitual',
            ),
          );
        if (
          !original.student.isActive ||
          original.subscription.status !== 'ACTIVE'
        )
          throw new ConflictException(
            apiFailure(
              ErrorCode.RECOVERY_UNAVAILABLE,
              'La alumna o el contrato no habilitan una recuperación',
            ),
          );
        if (
          await tx.recovery.findFirst({
            where: { originalAbsenceId: attendanceId, cancelledAt: null },
            select: { id: true },
          })
        )
          throw new ConflictException(
            apiFailure(
              ErrorCode.RECOVERY_ALREADY_AUTHORIZED,
              'La ausencia ya tiene una recuperación',
            ),
          );
        const rows = await tx.classSession.findMany({
          where: {
            status: 'SCHEDULED',
            id: { not: original.classSessionId },
            occurrenceDate: range,
            startAt: {
              gt: new Date(
                Math.max(
                  now.getTime(),
                  original.classSession.startAt.getTime(),
                ),
              ),
              gte: original.subscription.periodStart,
              lt: original.subscription.periodEnd,
            },
          },
          include: { schedule: { select: { dayOfWeek: true } } },
          orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
          take: 1001,
        });
        this.assertCandidateLimit(rows.length);
        const reservations = await this.participation.forSessions(
          tx,
          rows,
          false,
        );
        const existing = await tx.attendance.findMany({
          where: {
            studentId: original.studentId,
            classSessionId: { in: rows.map((r) => r.id) },
          },
          select: { classSessionId: true },
        });
        const existingIds = new Set(existing.map((r) => r.classSessionId));
        const authorizations = await tx.recovery.findMany({
          where: {
            studentId: original.studentId,
            recoverySessionId: { in: rows.map((r) => r.id) },
            cancelledAt: null,
          },
          select: { recoverySessionId: true },
        });
        for (const authorization of authorizations)
          existingIds.add(authorization.recoverySessionId);
        const items = rows.flatMap((row) => {
          const reserved = reservations.get(row.id) ?? [];
          const occupied = reserved.length,
            available = availableCapacity(row.capacity, occupied);
          if (
            !available ||
            existingIds.has(row.id) ||
            reserved.some((p) => p.student.id === original.studentId) ||
            !wasActiveAt(original.student.activePeriods, row.startAt) ||
            !subscriptionCoversRecovery(original.subscription, row.startAt)
          )
            return [];
          return [
            {
              ...readClass(row),
              capacity: row.capacity,
              occupied,
              available,
              dayOfWeek: row.schedule.dayOfWeek,
            },
          ];
        });
        return {
          items: items.slice(
            (query.page - 1) * query.limit,
            query.page * query.limit,
          ),
          meta: meta(query, items.length),
          availabilityAsOf: now,
          timeZone: this.time.timeZone,
          dateFrom,
          dateTo,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
