import { apiFailure, ErrorCode } from '../common/http/error-code';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CLOCK, Clock } from '../time/clock';
import { correctionReason } from './attendance-correction-domain';
import { PageQueryDto } from '../audit/dto/audit.dto';

const correctionProjection = {
  id: true,
  attendanceId: true,
  sequence: true,
  previousStatus: true,
  targetStatus: true,
  reason: true,
  correctedByAdminId: true,
  correctedAt: true,
} satisfies Prisma.AttendanceCorrectionSelect;
const attendanceProjection = {
  id: true,
  studentId: true,
  subscriptionId: true,
  classSessionId: true,
  originalStatus: true,
  status: true,
  source: true,
  recordedAt: true,
  recoveryId: true,
} satisfies Prisma.AttendanceSelect;

@Injectable()
export class AttendanceCorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async correct(
    id: string,
    targetStatus: AttendanceStatus,
    reason: string,
    adminId: string,
  ) {
    reason = correctionReason(reason);
    if (!Object.values(AttendanceStatus).includes(targetStatus))
      throw new BadRequestException('Estado inválido');
    const identity = await this.prisma.attendance.findUnique({
      where: { id },
      select: attendanceProjection,
    });
    if (!identity) throw new NotFoundException('Asistencia no encontrada');
    return this.prisma.$transaction(async (tx) => {
      // Same graph as registration/reconciliation. Never lock a Recovery target from its origin.
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "ClassSession" WHERE "id" = ${identity.classSessionId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Student" WHERE "id" = ${identity.studentId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Subscription" WHERE "id" = ${identity.subscriptionId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Attendance" WHERE "id" = ${id} FOR UPDATE`,
      );
      const current = await tx.attendance.findUnique({
        where: { id },
        select: attendanceProjection,
      });
      if (!current) throw new NotFoundException('Asistencia no encontrada');
      const session = await tx.classSession.findUniqueOrThrow({
        where: { id: current.classSessionId },
        select: { status: true },
      });
      if (session.status === 'CANCELLED')
        throw new ConflictException(
          apiFailure(
            ErrorCode.ATTENDANCE_CORRECTION_BLOCKED,
            'Anomalía de integridad: asistencia en clase cancelada; requiere revisión administrativa',
          ),
        );
      if (current.status === targetStatus)
        return {
          attendance: {
            ...current,
            consumesAllowance: current.recoveryId === null,
          },
          correction: null,
        };
      if (targetStatus === 'PRESENT') {
        const recovery = await tx.recovery.findFirst({
          where: { originalAbsenceId: id, cancelledAt: null },
          select: { id: true, attendance: { select: { id: true } } },
        });
        if (recovery?.attendance)
          throw new ConflictException(
            apiFailure(
              ErrorCode.ATTENDANCE_CORRECTION_BLOCKED,
              'La ausencia tiene una recuperación con resultado; no puede corregirse',
            ),
          );
        if (recovery)
          throw new ConflictException(
            apiFailure(
              ErrorCode.ATTENDANCE_CORRECTION_BLOCKED,
              'Cancelá primero la recuperación pendiente de esta ausencia',
            ),
          );
      }
      const last = await tx.attendanceCorrection.findFirst({
        where: { attendanceId: id },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });
      const correction = await tx.attendanceCorrection.create({
        data: {
          attendanceId: id,
          sequence: (last?.sequence ?? 0) + 1,
          previousStatus: current.status,
          targetStatus,
          reason,
          correctedByAdminId: adminId,
          correctedAt: this.clock.now(),
        },
        select: correctionProjection,
      });
      const attendance = await tx.attendance.update({
        where: { id },
        data: { status: targetStatus },
        select: attendanceProjection,
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: adminId,
          action: 'ATTENDANCE_CORRECTED',
          entity: 'Attendance',
          entityId: id,
          metadata: {
            correctionId: correction.id,
            sequence: correction.sequence,
            previousStatus: current.status,
            targetStatus,
            reason,
          },
          createdAt: correction.correctedAt,
        },
      });
      return {
        attendance: {
          ...attendance,
          consumesAllowance: attendance.recoveryId === null,
        },
        correction,
      };
    });
  }

  async history(attendanceId: string, query: PageQueryDto) {
    return this.prisma.$transaction(
      async (tx) => {
        if (
          !(await tx.attendance.findUnique({
            where: { id: attendanceId },
            select: { id: true },
          }))
        )
          throw new NotFoundException('Asistencia no encontrada');
        const where = { attendanceId };
        const total = await tx.attendanceCorrection.count({ where });
        const items = await tx.attendanceCorrection.findMany({
          where,
          select: correctionProjection,
          orderBy: { sequence: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        });
        return {
          items,
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
}
