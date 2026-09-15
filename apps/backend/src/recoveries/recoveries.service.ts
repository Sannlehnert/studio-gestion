import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ClassParticipationService } from '../class-sessions/class-participation.service';
import { StudentStatusHistoryService } from '../students/student-status-history.service';
import { CLOCK, Clock } from '../time/clock';
import { databaseDateToLocalDate } from '../time/business-time';
import {
  AdminRecoveryQueryDto,
  RecoveryCancellationFilter,
  StudentRecoveryQueryDto,
} from './dto/recovery.dto';
import {
  recoverableAbsence,
  recoveryState,
  subscriptionCoversRecovery,
} from './recovery-domain';

const projection = {
  id: true,
  studentId: true,
  subscriptionId: true,
  authorizedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  originalAbsence: {
    select: { id: true, classSessionId: true, status: true, recordedAt: true },
  },
  recoverySession: {
    select: {
      id: true,
      occurrenceDate: true,
      startAt: true,
      endAt: true,
      status: true,
      cancelledAt: true,
      cancellationReason: true,
    },
  },
  subscription: {
    select: {
      periodStart: true,
      periodEnd: true,
      status: true,
      cancelledAt: true,
    },
  },
  attendance: {
    select: { id: true, classSessionId: true, status: true, recordedAt: true },
  },
} satisfies Prisma.RecoverySelect;
type RecoveryView = Prisma.RecoveryGetPayload<{ select: typeof projection }>;

@Injectable()
export class RecoveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly participation: ClassParticipationService,
    private readonly history: StudentStatusHistoryService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async authorize(
    originalAttendanceId: string,
    targetClassSessionId: string,
    adminId: string,
  ) {
    const target = await this.prisma.classSession.findUnique({
      where: { id: targetClassSessionId },
      select: { scheduleId: true },
    });
    if (!target) throw new NotFoundException('Clase destino no encontrada');
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockTarget(tx, target.scheduleId, targetClassSessionId);
        const original = await tx.attendance.findUnique({
          where: { id: originalAttendanceId },
          include: { classSession: true },
        });
        if (!original) throw new NotFoundException('Ausencia no encontrada');
        if (
          !recoverableAbsence(original, targetClassSessionId) ||
          original.classSession.status === 'CANCELLED'
        ) {
          throw new ConflictException(
            'Se requiere una ausencia habitual de otra clase',
          );
        }
        await this.lockStudentAndSubscription(
          tx,
          original.studentId,
          original.subscriptionId,
        );
        // Correction shares the Student lock. Re-read after waiting, before authorization.
        const currentOriginal = await tx.attendance.findUniqueOrThrow({
          where: { id: original.id },
        });
        if (!recoverableAbsence(currentOriginal, targetClassSessionId))
          throw new ConflictException(
            'La asistencia original ya no es una ausencia recuperable',
          );
        const prior = await tx.recovery.findFirst({
          where: { originalAbsenceId: original.id, cancelledAt: null },
          select: projection,
        });
        if (prior) {
          if (prior.recoverySession.id !== targetClassSessionId)
            throw new ConflictException(
              'La ausencia ya tiene otra recuperación; cancelala antes de cambiar el destino',
            );
          return this.view(tx, prior);
        }
        const session = await tx.classSession.findUniqueOrThrow({
          where: { id: targetClassSessionId },
        });
        const subscription = await tx.subscription.findUniqueOrThrow({
          where: { id: original.subscriptionId },
        });
        const student = await tx.student.findUniqueOrThrow({
          where: { id: original.studentId },
        });
        if (
          session.status !== 'SCHEDULED' ||
          session.startAt <= this.clock.now() ||
          session.startAt <= original.classSession.startAt
        ) {
          throw new ConflictException(
            'La recuperación requiere una clase posterior y todavía no iniciada',
          );
        }
        if (
          !student.isActive ||
          !(await this.history.wasActiveAt(tx, student.id, session.startAt))
        )
          throw new ConflictException('Alumna no disponible para recuperar');
        if (
          subscription.status !== 'ACTIVE' ||
          !subscriptionCoversRecovery(subscription, session.startAt)
        )
          throw new ConflictException(
            'El destino debe pertenecer al mismo período contractual vigente',
          );
        if (
          (await this.participation.normal(tx, session)).some(
            (row) => row.student.id === student.id,
          )
        )
          throw new ConflictException(
            'La clase destino ya es una clase habitual de la alumna',
          );
        if (
          await tx.attendance.findUnique({
            where: {
              studentId_classSessionId: {
                studentId: student.id,
                classSessionId: session.id,
              },
            },
          })
        )
          throw new ConflictException(
            'El destino ya tiene asistencia registrada',
          );
        if (
          await tx.recovery.findFirst({
            where: {
              studentId: student.id,
              recoverySessionId: session.id,
              cancelledAt: null,
            },
          })
        )
          throw new ConflictException(
            'La alumna ya tiene una recuperación hacia esa clase',
          );
        const occupied = await this.participation.reservations(tx, session);
        occupied.add(student.id);
        if (occupied.size > session.capacity)
          throw new ConflictException('La clase destino no tiene cupo');
        const authorizedAt = this.clock.now();
        if (authorizedAt >= session.startAt)
          throw new ConflictException('La clase destino ya comenzó');
        const record = await tx.recovery.create({
          data: {
            originalAbsenceId: original.id,
            recoverySessionId: session.id,
            studentId: student.id,
            subscriptionId: subscription.id,
            authorizedByAdminId: adminId,
            authorizedAt,
          },
          select: projection,
        });
        await tx.auditLog.create({
          data: {
            actorType: 'ADMIN',
            actorId: adminId,
            action: 'RECOVERY_AUTHORIZED',
            entity: 'Recovery',
            entityId: record.id,
            metadata: {
              originalAttendanceId: original.id,
              targetClassSessionId: session.id,
              studentId: student.id,
              subscriptionId: subscription.id,
            },
          },
        });
        return this.view(tx, record);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'La ausencia o el destino ya tienen una recuperación',
        );
      throw error;
    }
  }

  async cancel(id: string, reason: string, adminId: string) {
    const identity = await this.prisma.recovery.findUnique({
      where: { id },
      select: {
        recoverySessionId: true,
        recoverySession: { select: { scheduleId: true } },
      },
    });
    if (!identity) throw new NotFoundException('Recuperación no encontrada');
    return this.prisma.$transaction(async (tx) => {
      await this.lockTarget(
        tx,
        identity.recoverySession.scheduleId,
        identity.recoverySessionId,
      );
      const current = await tx.recovery.findUniqueOrThrow({
        where: { id },
        select: projection,
      });
      await this.lockStudentAndSubscription(
        tx,
        current.studentId,
        current.subscriptionId,
      );
      const record = await tx.recovery.findUniqueOrThrow({
        where: { id },
        select: projection,
      });
      if (record.cancelledAt) return this.view(tx, record);
      if (record.attendance)
        throw new ConflictException(
          'Una recuperación con asistencia no puede cancelarse',
        );
      const unavailable =
        record.recoverySession.status === 'CANCELLED' ||
        !subscriptionCoversRecovery(
          record.subscription,
          record.recoverySession.startAt,
        );
      const cancelledAt = this.clock.now();
      if (!unavailable && cancelledAt >= record.recoverySession.startAt)
        throw new ConflictException('La recuperación ya comenzó');
      const updated = await tx.recovery.update({
        where: { id },
        data: {
          cancelledAt,
          cancelledByAdminId: adminId,
          cancellationReason: reason,
        },
        select: projection,
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: adminId,
          action: 'RECOVERY_CANCELLED',
          entity: 'Recovery',
          entityId: id,
          metadata: { reason },
        },
      });
      return this.view(tx, updated);
    });
  }

  list(
    query: StudentRecoveryQueryDto | AdminRecoveryQueryDto,
    ownerId?: string,
  ) {
    const admin = query as AdminRecoveryQueryDto;
    const where: Prisma.RecoveryWhereInput = {
      ...(ownerId || admin.studentId
        ? { studentId: ownerId ?? admin.studentId }
        : {}),
      ...(admin.originalAttendanceId
        ? { originalAbsenceId: admin.originalAttendanceId }
        : {}),
      ...(query.cancellation === RecoveryCancellationFilter.ALL
        ? {}
        : {
            cancelledAt:
              query.cancellation === RecoveryCancellationFilter.CANCELLED
                ? { not: null }
                : null,
          }),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const total = await tx.recovery.count({ where });
        const rows = await tx.recovery.findMany({
          where,
          select: projection,
          orderBy: [{ authorizedAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        });
        return {
          items: await Promise.all(rows.map((row) => this.view(tx, row))),
          meta: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.ceil(total / query.limit),
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  get(id: string, ownerId?: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const record = await tx.recovery.findFirst({
          where: { id, ...(ownerId ? { studentId: ownerId } : {}) },
          select: projection,
        });
        if (!record) throw new NotFoundException('Recuperación no encontrada');
        return this.view(tx, record);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  private async view(tx: Prisma.TransactionClient, record: RecoveryView) {
    const { subscription, recoverySession, ...publicRecord } = record;
    return {
      ...publicRecord,
      targetClassSession: {
        ...recoverySession,
        occurrenceDate: databaseDateToLocalDate(recoverySession.occurrenceDate),
      },
      subscriptionCancelledAt: subscription.cancelledAt,
      ...recoveryState(
        record.cancelledAt,
        record.attendance?.status ?? null,
        recoverySession,
        subscription,
        await this.history.wasActiveAt(
          tx,
          record.studentId,
          recoverySession.startAt,
        ),
      ),
    };
  }
  private async lockTarget(
    tx: Prisma.TransactionClient,
    scheduleId: string,
    sessionId: string,
  ) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Schedule" WHERE "id" = ${scheduleId} FOR UPDATE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "ClassSession" WHERE "id" = ${sessionId} FOR UPDATE`,
    );
  }
  private async lockStudentAndSubscription(
    tx: Prisma.TransactionClient,
    studentId: string,
    subscriptionId: string,
  ) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Student" WHERE "id" = ${studentId} FOR UPDATE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Subscription" WHERE "id" = ${subscriptionId} FOR UPDATE`,
    );
  }
}
