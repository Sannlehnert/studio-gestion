import { apiFailure, ErrorCode } from '../common/http/error-code';
import {
  ClassParticipationService,
  ParticipationSession,
} from './class-participation.service';
import { subscriptionCoversRecovery } from '../recoveries/recovery-domain';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClassSessionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  databaseDateToLocalDate,
  isoDayOfWeek,
  localDateToDatabaseDate,
  localDatesInclusive,
  minuteToTime,
  parseLocalDate,
} from '../time/business-time';
import { BusinessTimeService } from '../time/business-time.service';
import { CLOCK, Clock } from '../time/clock';
import {
  CancelClassSessionDto,
  ClassSessionStatusFilter,
  GenerateClassSessionsDto,
  ListClassSessionsQueryDto,
  UpdateClassSessionCapacityDto,
  UpdateClassSessionTimeDto,
} from './dto/class-session.dto';

const classSessionProjection = {
  id: true,
  scheduleId: true,
  occurrenceDate: true,
  startAt: true,
  endAt: true,
  capacity: true,
  status: true,
  cancelledAt: true,
  cancellationReason: true,
  attendanceClosedAt: true,
  createdAt: true,
  updatedAt: true,
  schedule: {
    select: {
      id: true,
      dayOfWeek: true,
      startMinute: true,
      endMinute: true,
      defaultCapacity: true,
    },
  },
} satisfies Prisma.ClassSessionSelect;

type ClassSessionView = Prisma.ClassSessionGetPayload<{
  select: typeof classSessionProjection;
}>;

@Injectable()
export class ClassSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessTime: BusinessTimeService,
    private readonly participation: ClassParticipationService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async generate(dto: GenerateClassSessionsDto, actorId: string) {
    const dates = this.parseGenerationRange(dto.dateFrom, dto.dateTo);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Schedule" WHERE "isActive" = true ORDER BY "id" FOR SHARE`,
      );
      const schedules = await tx.schedule.findMany({
        where: { isActive: true },
        select: {
          id: true,
          dayOfWeek: true,
          startMinute: true,
          endMinute: true,
          defaultCapacity: true,
        },
        orderBy: { id: 'asc' },
      });
      const candidates = schedules.flatMap((schedule) =>
        dates
          .filter((date) => isoDayOfWeek(date) === schedule.dayOfWeek)
          .map((date) => ({
            scheduleId: schedule.id,
            occurrenceDate: localDateToDatabaseDate(date),
            startAt: this.localInstant(date, schedule.startMinute),
            endAt: this.localInstant(date, schedule.endMinute),
            capacity: schedule.defaultCapacity,
          })),
      );
      const inserted = candidates.length
        ? await tx.classSession.createMany({
            data: candidates,
            skipDuplicates: true,
          })
        : { count: 0 };
      if (inserted.count > 0) {
        await tx.auditLog.create({
          data: {
            actorType: 'ADMIN',
            actorId,
            action: 'CLASS_SESSIONS_GENERATED',
            entity: 'ClassSession',
            metadata: {
              dateFrom: dto.dateFrom,
              dateTo: dto.dateTo,
              candidateCount: candidates.length,
              createdCount: inserted.count,
              timeZone: this.businessTime.timeZone,
            },
          },
        });
      }
      return {
        candidateCount: candidates.length,
        createdCount: inserted.count,
        existingCount: candidates.length - inserted.count,
        timeZone: this.businessTime.timeZone,
      };
    });
  }

  async list(query: ListClassSessionsQueryDto) {
    const now = this.clock.now();
    if (query.today && (query.dateFrom || query.dateTo))
      throw new BadRequestException('today no admite dateFrom/dateTo');
    if (query.today)
      query = {
        ...query,
        dateFrom: this.businessTime.today(now),
        dateTo: this.businessTime.today(now),
      };
    this.assertListRange(query.dateFrom, query.dateTo);
    const where: Prisma.ClassSessionWhereInput = {
      ...(query.status === ClassSessionStatusFilter.ALL
        ? {}
        : { status: query.status.toUpperCase() as ClassSessionStatus }),
      ...(query.scheduleId ? { scheduleId: query.scheduleId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            occurrenceDate: {
              ...(query.dateFrom
                ? { gte: localDateToDatabaseDate(query.dateFrom) }
                : {}),
              ...(query.dateTo
                ? { lte: localDateToDatabaseDate(query.dateTo) }
                : {}),
            },
          }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const result = await this.prisma.$transaction(
      async (tx) => {
        const total = await tx.classSession.count({ where });
        const items = await tx.classSession.findMany({
          where,
          select: classSessionProjection,
          orderBy: [
            { occurrenceDate: 'asc' },
            { startAt: 'asc' },
            { id: 'asc' },
          ],
          skip,
          take: query.limit,
        });
        return { total, items };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items: result.items.map((item) => this.serialize(item)),
      ...(query.today
        ? {
            readAt: now,
            businessDate: this.businessTime.today(now),
            timeZone: this.businessTime.timeZone,
          }
        : {}),
      meta: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit),
      },
    };
  }

  async getById(id: string) {
    const session = await this.prisma.classSession.findUnique({
      where: { id },
      select: classSessionProjection,
    });
    if (!session) throw new NotFoundException('Clase no encontrada');
    return this.serialize(session);
  }

  async updateCapacity(
    id: string,
    dto: UpdateClassSessionCapacityDto,
    actorId: string,
  ) {
    const session = await this.withLockedSession(id, async (tx, current) => {
      this.assertEditable(current.status);
      if (current.capacity === dto.capacity) return current;
      const reservedCount = await this.capacityReservationCount(tx, current);
      if (dto.capacity < reservedCount) {
        throw new ConflictException(
          apiFailure(
            ErrorCode.CAPACITY_CONFLICT,
            'La capacidad es menor que las alumnas esperadas para la clase',
          ),
        );
      }
      const updated = await tx.classSession.update({
        where: { id },
        data: { capacity: dto.capacity },
        select: classSessionProjection,
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId,
          action: 'CLASS_SESSION_CAPACITY_CHANGED',
          entity: 'ClassSession',
          entityId: id,
          metadata: { before: current.capacity, after: dto.capacity },
        },
      });
      return updated;
    });
    return this.serialize(session);
  }

  async updateTime(
    id: string,
    dto: UpdateClassSessionTimeDto,
    actorId: string,
  ) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('Fecha y hora inválida');
    }
    if (startAt >= endAt) {
      throw new BadRequestException('startAt debe ser anterior a endAt');
    }
    if (endAt.getTime() - startAt.getTime() > 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Una clase no puede durar más de 24 horas');
    }
    const session = await this.withLockedSession(id, async (tx, current) => {
      this.assertEditable(current.status);
      const occurrenceDate = databaseDateToLocalDate(current.occurrenceDate);
      if (
        this.businessTime.localDate(startAt) !== occurrenceDate ||
        this.businessTime.localDate(endAt) !== occurrenceDate
      ) {
        throw new BadRequestException(
          'La excepción horaria debe permanecer en la fecha local de la clase',
        );
      }
      if (
        current.startAt.getTime() === startAt.getTime() &&
        current.endAt.getTime() === endAt.getTime()
      ) {
        return current;
      }
      const recoveries = await tx.recovery.findMany({
        where: { recoverySessionId: id, cancelledAt: null },
        include: { subscription: true },
      });
      const revised = { ...current, startAt, endAt };
      const normal = await this.participation.normal(tx, revised);
      for (const recovery of recoveries) {
        if (
          startAt <= recovery.authorizedAt ||
          !subscriptionCoversRecovery(recovery.subscription, startAt) ||
          normal.some((row) => row.student.id === recovery.studentId)
        ) {
          throw new ConflictException(
            'El cambio horario invalida una recuperación autorizada',
          );
        }
      }
      if (
        (await this.participation.reservations(tx, revised)).size >
        current.capacity
      )
        throw new ConflictException(
          'El cambio horario supera el cupo de la clase',
        );
      const updated = await tx.classSession.update({
        where: { id },
        data: { startAt, endAt },
        select: classSessionProjection,
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId,
          action: 'CLASS_SESSION_TIME_CHANGED',
          entity: 'ClassSession',
          entityId: id,
          metadata: {
            before: { startAt: current.startAt, endAt: current.endAt },
            after: { startAt, endAt },
          },
        },
      });
      return updated;
    });
    return this.serialize(session);
  }

  async cancel(id: string, dto: CancelClassSessionDto, actorId: string) {
    const session = await this.withLockedSession(id, async (tx, current) => {
      if (current.status === ClassSessionStatus.CANCELLED) return current;
      if (current.status === ClassSessionStatus.COMPLETED) {
        throw new ConflictException('Una clase completada no puede cancelarse');
      }
      if ((await tx.attendance.count({ where: { classSessionId: id } })) > 0) {
        throw new ConflictException(
          'Una clase con asistencia registrada no puede cancelarse',
        );
      }
      const updated = await tx.classSession.update({
        where: { id },
        data: {
          status: ClassSessionStatus.CANCELLED,
          cancelledAt: this.clock.now(),
          cancelledByAdminId: actorId,
          cancellationReason: dto.reason,
        },
        select: classSessionProjection,
      });
      await tx.attendanceChallenge.updateMany({
        where: { classSessionId: id, revokedAt: null },
        data: { revokedAt: updated.cancelledAt! },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId,
          action: 'CLASS_SESSION_CANCELLED',
          entity: 'ClassSession',
          entityId: id,
          metadata: { reason: dto.reason },
        },
      });
      return updated;
    });
    return this.serialize(session);
  }

  async expectedStudents(id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const session = await tx.classSession.findUnique({
          where: { id },
          select: {
            id: true,
            scheduleId: true,
            occurrenceDate: true,
            startAt: true,
            status: true,
          },
        });
        if (!session) throw new NotFoundException('Clase no encontrada');
        if (session.status === ClassSessionStatus.CANCELLED) {
          return {
            classSessionId: id,
            classSessionStatus: session.status,
            attendanceRequired: false,
            items: [],
          };
        }
        const enrollments = await this.findExpectedRecords(tx, session);
        return {
          classSessionId: id,
          classSessionStatus: session.status,
          attendanceRequired: true,
          items: enrollments.map((enrollment) => ({
            studentId: enrollment.student.id,
            fullName: enrollment.student.fullName,
            enrollmentId: enrollment.enrollmentId,
            recoveryId: enrollment.recoveryId,
            origin: enrollment.origin,
            subscriptionId: enrollment.subscriptionId,
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async capacityReservationCount(
    tx: Prisma.TransactionClient,
    session: ParticipationSession & { status: ClassSessionStatus },
  ) {
    return (await this.participation.reservations(tx, session)).size;
  }

  findExpectedRecords(
    client: Prisma.TransactionClient | PrismaService,
    session: ParticipationSession,
  ) {
    return this.participation.expected(client, session);
  }

  private async withLockedSession<T>(
    id: string,
    operation: (
      tx: Prisma.TransactionClient,
      current: ClassSessionView,
    ) => Promise<T>,
  ) {
    const identity = await this.prisma.classSession.findUnique({
      where: { id },
      select: { scheduleId: true },
    });
    if (!identity) throw new NotFoundException('Clase no encontrada');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Schedule" WHERE "id" = ${identity.scheduleId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "ClassSession" WHERE "id" = ${id} FOR UPDATE`,
      );
      const current = await tx.classSession.findUnique({
        where: { id },
        select: classSessionProjection,
      });
      if (!current) throw new NotFoundException('Clase no encontrada');
      return operation(tx, current);
    });
  }

  private assertEditable(status: ClassSessionStatus) {
    if (status !== ClassSessionStatus.SCHEDULED) {
      throw new ConflictException(
        'Sólo una clase programada admite excepciones',
      );
    }
  }

  private parseGenerationRange(dateFrom: string, dateTo: string) {
    try {
      return localDatesInclusive(dateFrom, dateTo, 366);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private localInstant(date: string, minute: number) {
    try {
      return this.businessTime.instant(date, minute);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private assertListRange(dateFrom?: string, dateTo?: string) {
    try {
      if (dateFrom) parseLocalDate(dateFrom);
      if (dateTo) parseLocalDate(dateTo);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new BadRequestException('El rango de fechas está invertido');
    }
  }

  private serialize(session: ClassSessionView) {
    const {
      schedule: { startMinute, endMinute, ...schedule },
      occurrenceDate,
      ...publicFields
    } = session;
    return {
      ...publicFields,
      occurrenceDate: databaseDateToLocalDate(occurrenceDate),
      schedule: {
        ...schedule,
        startTime: minuteToTime(startMinute),
        endTime: minuteToTime(endMinute),
      },
    };
  }
}
