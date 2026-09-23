import { apiFailure, ErrorCode } from '../common/http/error-code';
import { ClassParticipationService } from '../class-sessions/class-participation.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClassSessionStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  databaseDateToLocalDate,
  localDateToDatabaseDate,
  minuteToTime,
  parseLocalDate,
} from '../time/business-time';
import { BusinessTimeService } from '../time/business-time.service';
import {
  enrollmentOperationalStatus,
  intervalHasWeekday,
  maximumConcurrentEnrollments,
} from './enrollment-domain';
import {
  ChangeEnrollmentScheduleDto,
  CreateEnrollmentDto,
  EndEnrollmentDto,
  EnrollmentStatusFilter,
  ListEnrollmentsQueryDto,
} from './dto/enrollment.dto';

const enrollmentProjection = {
  id: true,
  studentId: true,
  subscriptionId: true,
  scheduleId: true,
  validFrom: true,
  validUntil: true,
  createdAt: true,
  updatedAt: true,
  student: { select: { id: true, fullName: true } },
  schedule: {
    select: {
      id: true,
      dayOfWeek: true,
      startMinute: true,
      endMinute: true,
      defaultCapacity: true,
    },
  },
} satisfies Prisma.EnrollmentSelect;

type EnrollmentView = Prisma.EnrollmentGetPayload<{
  select: typeof enrollmentProjection;
}>;

type ParentFilter =
  | { kind: 'student'; id: string }
  | { kind: 'subscription'; id: string }
  | { kind: 'schedule'; id: string };

@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly participation: ClassParticipationService,
    private readonly businessTime: BusinessTimeService,
  ) {}

  async create(dto: CreateEnrollmentDto, actorId: string) {
    this.assertValidDates(dto.validFrom, dto.validUntil);
    const today = this.businessTime.today();
    if (dto.validFrom < today) {
      throw new BadRequestException(
        'La vigencia no puede comenzar antes de la fecha local actual',
      );
    }
    try {
      const enrollment = await this.prisma.$transaction(async (tx) => {
        const context = await this.lockAndLoadContext(
          tx,
          dto.studentId,
          dto.subscriptionId,
          [dto.scheduleId],
        );
        const schedule = context.schedules[0];
        this.assertContext(
          context.student,
          context.subscription,
          schedule,
          dto.studentId,
          dto.validFrom,
          dto.validUntil,
        );
        await this.assertNoDuplicate(
          tx,
          dto.studentId,
          dto.scheduleId,
          dto.validFrom,
          dto.validUntil,
        );
        await this.assertCapacity(
          tx,
          schedule,
          dto.validFrom,
          dto.validUntil,
          dto.studentId,
        );
        const created = await tx.enrollment.create({
          data: {
            studentId: dto.studentId,
            subscriptionId: dto.subscriptionId,
            scheduleId: dto.scheduleId,
            validFrom: localDateToDatabaseDate(dto.validFrom),
            validUntil: localDateToDatabaseDate(dto.validUntil),
          },
          select: enrollmentProjection,
        });
        await tx.auditLog.create({
          data: {
            actorType: 'ADMIN',
            actorId,
            action: 'ENROLLMENT_CREATED',
            entity: 'Enrollment',
            entityId: created.id,
            metadata: {
              studentId: dto.studentId,
              subscriptionId: dto.subscriptionId,
              scheduleId: dto.scheduleId,
              validFrom: dto.validFrom,
              validUntil: dto.validUntil,
            },
          },
        });
        return created;
      });
      return this.serialize(enrollment);
    } catch (error) {
      if (this.isOverlapConstraint(error)) {
        throw new ConflictException(
          'La alumna ya tiene una inscripción superpuesta en ese horario',
        );
      }
      throw error;
    }
  }

  async getById(id: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id },
      select: enrollmentProjection,
    });
    if (!enrollment) throw new NotFoundException('Inscripción no encontrada');
    return this.serialize(enrollment);
  }

  async list(parent: ParentFilter, query: ListEnrollmentsQueryDto) {
    await this.assertParentExists(parent);
    const today = localDateToDatabaseDate(this.businessTime.today());
    const statusWhere: Prisma.EnrollmentWhereInput =
      query.status === EnrollmentStatusFilter.ACTIVE
        ? { validFrom: { lte: today }, validUntil: { gt: today } }
        : query.status === EnrollmentStatusFilter.UPCOMING
          ? { validFrom: { gt: today } }
          : query.status === EnrollmentStatusFilter.EXPIRED
            ? { validUntil: { lte: today } }
            : {};
    const where: Prisma.EnrollmentWhereInput = {
      ...statusWhere,
      ...(parent.kind === 'student'
        ? { studentId: parent.id }
        : parent.kind === 'subscription'
          ? { subscriptionId: parent.id }
          : { scheduleId: parent.id }),
    };
    const skip = (query.page - 1) * query.limit;
    const result = await this.prisma.$transaction(
      async (tx) => {
        const total = await tx.enrollment.count({ where });
        const items = await tx.enrollment.findMany({
          where,
          select: enrollmentProjection,
          orderBy: [{ validFrom: 'desc' }, { id: 'asc' }],
          skip,
          take: query.limit,
        });
        return { total, items };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items: result.items.map((item) => this.serialize(item)),
      meta: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit),
      },
    };
  }

  async end(id: string, dto: EndEnrollmentDto, actorId: string) {
    this.assertLocalDate(dto.validUntil);
    const identity = await this.findIdentity(id);
    const enrollment = await this.prisma.$transaction(async (tx) => {
      await this.lockContextRows(
        tx,
        identity.studentId,
        identity.subscriptionId,
        [identity.scheduleId],
      );
      await this.lockEnrollment(tx, id);
      const current = await tx.enrollment.findUnique({
        where: { id },
        select: enrollmentProjection,
      });
      if (!current) throw new NotFoundException('Inscripción no encontrada');
      const validFrom = databaseDateToLocalDate(current.validFrom);
      const currentUntil = databaseDateToLocalDate(current.validUntil);
      if (dto.validUntil === currentUntil) return current;
      if (
        dto.validUntil <= validFrom ||
        dto.validUntil > currentUntil ||
        dto.validUntil < this.businessTime.today()
      ) {
        throw new BadRequestException(
          'La nueva fecha final debe acortar la vigencia sin reescribir el pasado',
        );
      }
      const updated = await tx.enrollment.update({
        where: { id },
        data: { validUntil: localDateToDatabaseDate(dto.validUntil) },
        select: enrollmentProjection,
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId,
          action: 'ENROLLMENT_ENDED',
          entity: 'Enrollment',
          entityId: id,
          metadata: { before: currentUntil, after: dto.validUntil },
        },
      });
      return updated;
    });
    return this.serialize(enrollment);
  }

  async changeSchedule(
    id: string,
    dto: ChangeEnrollmentScheduleDto,
    actorId: string,
  ) {
    this.assertLocalDate(dto.effectiveDate);
    if (dto.effectiveDate < this.businessTime.today()) {
      throw new BadRequestException(
        'El cambio no puede reescribir fechas locales pasadas',
      );
    }
    const identity = await this.findIdentity(id);
    if (identity.scheduleId === dto.scheduleId) {
      throw new BadRequestException('El nuevo horario debe ser diferente');
    }
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const context = await this.lockAndLoadContext(
          tx,
          identity.studentId,
          identity.subscriptionId,
          [identity.scheduleId, dto.scheduleId],
        );
        await this.lockEnrollment(tx, id);
        const current = await tx.enrollment.findUnique({
          where: { id },
          select: enrollmentProjection,
        });
        if (!current) throw new NotFoundException('Inscripción no encontrada');
        const validFrom = databaseDateToLocalDate(current.validFrom);
        const validUntil = databaseDateToLocalDate(current.validUntil);
        const replay = await tx.enrollment.findFirst({
          where: {
            studentId: identity.studentId,
            subscriptionId: identity.subscriptionId,
            scheduleId: dto.scheduleId,
            validFrom: localDateToDatabaseDate(dto.effectiveDate),
          },
          select: enrollmentProjection,
        });
        if (dto.effectiveDate === validUntil && replay) {
          return { endedEnrollment: current, newEnrollment: replay };
        }
        if (dto.effectiveDate <= validFrom || dto.effectiveDate >= validUntil) {
          throw new BadRequestException(
            'La fecha efectiva debe estar dentro de la vigencia actual',
          );
        }
        const target = context.schedules.find(
          (schedule) => schedule.id === dto.scheduleId,
        );
        this.assertContext(
          context.student,
          context.subscription,
          target,
          identity.studentId,
          dto.effectiveDate,
          validUntil,
        );
        await this.assertNoDuplicate(
          tx,
          identity.studentId,
          dto.scheduleId,
          dto.effectiveDate,
          validUntil,
        );
        await this.assertCapacity(
          tx,
          target!,
          dto.effectiveDate,
          validUntil,
          identity.studentId,
        );
        const endedEnrollment = await tx.enrollment.update({
          where: { id },
          data: { validUntil: localDateToDatabaseDate(dto.effectiveDate) },
          select: enrollmentProjection,
        });
        const newEnrollment = await tx.enrollment.create({
          data: {
            studentId: identity.studentId,
            subscriptionId: identity.subscriptionId,
            scheduleId: dto.scheduleId,
            validFrom: localDateToDatabaseDate(dto.effectiveDate),
            validUntil: current.validUntil,
          },
          select: enrollmentProjection,
        });
        await tx.auditLog.create({
          data: {
            actorType: 'ADMIN',
            actorId,
            action: 'ENROLLMENT_SCHEDULE_CHANGED',
            entity: 'Enrollment',
            entityId: newEnrollment.id,
            metadata: {
              previousEnrollmentId: id,
              previousScheduleId: identity.scheduleId,
              newScheduleId: dto.scheduleId,
              effectiveDate: dto.effectiveDate,
            },
          },
        });
        return { endedEnrollment, newEnrollment };
      });
      return {
        endedEnrollment: this.serialize(result.endedEnrollment),
        newEnrollment: this.serialize(result.newEnrollment),
      };
    } catch (error) {
      if (this.isOverlapConstraint(error)) {
        throw new ConflictException(
          'La alumna ya tiene una inscripción superpuesta en ese horario',
        );
      }
      throw error;
    }
  }

  private async lockAndLoadContext(
    tx: Prisma.TransactionClient,
    studentId: string,
    subscriptionId: string,
    scheduleIds: string[],
  ) {
    await this.lockContextRows(tx, studentId, subscriptionId, scheduleIds);
    const student = await tx.student.findUnique({
      where: { id: studentId },
      select: { id: true, isActive: true },
    });
    const subscription = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        id: true,
        studentId: true,
        periodStart: true,
        periodEnd: true,
        status: true,
      },
    });
    const schedules = await tx.schedule.findMany({
      where: { id: { in: scheduleIds } },
      select: {
        id: true,
        dayOfWeek: true,
        startMinute: true,
        endMinute: true,
        defaultCapacity: true,
        isActive: true,
      },
    });
    return { student, subscription, schedules };
  }

  private assertContext(
    student: { id: string; isActive: boolean } | null,
    subscription: {
      id: string;
      studentId: string;
      periodStart: Date;
      periodEnd: Date;
      status: SubscriptionStatus;
    } | null,
    schedule:
      | {
          id: string;
          dayOfWeek: number;
          startMinute: number;
          endMinute: number;
          defaultCapacity: number;
          isActive: boolean;
        }
      | undefined,
    studentId: string,
    validFrom: string,
    validUntil: string,
  ) {
    if (!student) throw new NotFoundException('Alumna no encontrada');
    if (!student.isActive) {
      throw new ConflictException('No se puede inscribir una alumna inactiva');
    }
    if (!subscription) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    if (subscription.studentId !== studentId) {
      throw new ConflictException('La suscripción no corresponde a la alumna');
    }
    if (
      subscription.status !== SubscriptionStatus.ACTIVE ||
      subscription.periodEnd <= new Date()
    ) {
      throw new ConflictException('La suscripción no está operativa');
    }
    if (!schedule) throw new NotFoundException('Horario no encontrado');
    if (!schedule.isActive) {
      throw new ConflictException('El horario está inactivo');
    }
    const subscriptionFrom = this.businessTime.localDate(
      subscription.periodStart,
    );
    const subscriptionUntil = this.businessTime.exclusiveLocalDate(
      subscription.periodEnd,
    );
    if (
      validFrom < subscriptionFrom ||
      validUntil > subscriptionUntil ||
      validFrom >= validUntil
    ) {
      throw new ConflictException(
        'La vigencia debe estar dentro del período de la suscripción',
      );
    }
    if (!intervalHasWeekday(validFrom, validUntil, schedule.dayOfWeek)) {
      throw new BadRequestException(
        'La vigencia no contiene ninguna fecha del horario elegido',
      );
    }
  }

  private async assertNoDuplicate(
    tx: Prisma.TransactionClient,
    studentId: string,
    scheduleId: string,
    validFrom: string,
    validUntil: string,
  ) {
    const duplicate = await tx.enrollment.findFirst({
      where: {
        studentId,
        scheduleId,
        validFrom: { lt: localDateToDatabaseDate(validUntil) },
        validUntil: { gt: localDateToDatabaseDate(validFrom) },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        'La alumna ya tiene una inscripción superpuesta en ese horario',
      );
    }
  }

  private async assertCapacity(
    tx: Prisma.TransactionClient,
    schedule: {
      id: string;
      defaultCapacity: number;
    },
    validFrom: string,
    validUntil: string,
    studentId: string,
  ) {
    const rows = await tx.enrollment.findMany({
      where: {
        scheduleId: schedule.id,
        validFrom: { lt: localDateToDatabaseDate(validUntil) },
        validUntil: { gt: localDateToDatabaseDate(validFrom) },
        subscription: { status: SubscriptionStatus.ACTIVE },
      },
      select: { validFrom: true, validUntil: true },
    });
    const existing = rows.map((row) => ({
      validFrom:
        databaseDateToLocalDate(row.validFrom).localeCompare(validFrom) < 0
          ? validFrom
          : databaseDateToLocalDate(row.validFrom),
      validUntil:
        databaseDateToLocalDate(row.validUntil).localeCompare(validUntil) > 0
          ? validUntil
          : databaseDateToLocalDate(row.validUntil),
    }));
    if (
      maximumConcurrentEnrollments([...existing, { validFrom, validUntil }]) >
      schedule.defaultCapacity
    ) {
      throw new ConflictException(
        apiFailure(
          ErrorCode.CAPACITY_CONFLICT,
          'El horario no tiene cupo disponible',
        ),
      );
    }

    const sessions = await tx.classSession.findMany({
      where: {
        scheduleId: schedule.id,
        occurrenceDate: {
          gte: localDateToDatabaseDate(validFrom),
          lt: localDateToDatabaseDate(validUntil),
        },
        status: { not: ClassSessionStatus.CANCELLED },
      },
      select: {
        id: true,
        scheduleId: true,
        occurrenceDate: true,
        startAt: true,
        status: true,
        capacity: true,
      },
    });
    for (const session of sessions) {
      const recoveries = await this.participation.recoveries(
        tx,
        session,
        false,
      );
      if (recoveries.some((row) => row.student.id === studentId))
        throw new ConflictException(
          'La inscripción se superpone con una recuperación; cancelala antes de inscribir',
        );
      const occupied = await this.participation.reservations(tx, session);
      occupied.add(studentId);
      if (occupied.size > session.capacity)
        throw new ConflictException(
          apiFailure(
            ErrorCode.CAPACITY_CONFLICT,
            'Una clase ya generada no tiene cupo para toda la vigencia',
          ),
        );
    }
  }

  private async assertParentExists(parent: ParentFilter) {
    const exists =
      parent.kind === 'student'
        ? await this.prisma.student.findUnique({
            where: { id: parent.id },
            select: { id: true },
          })
        : parent.kind === 'subscription'
          ? await this.prisma.subscription.findUnique({
              where: { id: parent.id },
              select: { id: true },
            })
          : await this.prisma.schedule.findUnique({
              where: { id: parent.id },
              select: { id: true },
            });
    if (!exists) {
      throw new NotFoundException(
        parent.kind === 'student'
          ? 'Alumna no encontrada'
          : parent.kind === 'subscription'
            ? 'Suscripción no encontrada'
            : 'Horario no encontrado',
      );
    }
  }

  private async findIdentity(id: string) {
    const identity = await this.prisma.enrollment.findUnique({
      where: { id },
      select: { studentId: true, subscriptionId: true, scheduleId: true },
    });
    if (!identity) throw new NotFoundException('Inscripción no encontrada');
    return identity;
  }

  private assertValidDates(validFrom: string, validUntil: string) {
    this.assertLocalDate(validFrom);
    this.assertLocalDate(validUntil);
    if (validFrom >= validUntil) {
      throw new BadRequestException('validFrom debe ser anterior a validUntil');
    }
  }

  private assertLocalDate(value: string) {
    try {
      parseLocalDate(value);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private serialize(enrollment: EnrollmentView) {
    const validFrom = databaseDateToLocalDate(enrollment.validFrom);
    const validUntil = databaseDateToLocalDate(enrollment.validUntil);
    const {
      schedule: { startMinute, endMinute, ...schedule },
      ...publicFields
    } = enrollment;
    return {
      ...publicFields,
      validFrom,
      validUntil,
      operationalStatus: enrollmentOperationalStatus(
        { validFrom, validUntil },
        this.businessTime.today(),
      ),
      schedule: {
        ...schedule,
        startTime: minuteToTime(startMinute),
        endTime: minuteToTime(endMinute),
      },
    };
  }

  private isOverlapConstraint(error: unknown) {
    return (
      error instanceof Error &&
      error.message.includes('Enrollment_no_schedule_overlap')
    );
  }

  private async lockContextRows(
    tx: Prisma.TransactionClient,
    studentId: string,
    subscriptionId: string,
    scheduleIds: string[],
  ) {
    // Schedule(s) first: compatible with ClassSession/Recovery capacity locks.
    for (const scheduleId of [...new Set(scheduleIds)].sort()) {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Schedule" WHERE "id" = ${scheduleId} FOR UPDATE`,
      );
    }
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Student" WHERE "id" = ${studentId} FOR UPDATE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Subscription" WHERE "id" = ${subscriptionId} FOR UPDATE`,
    );
  }

  private async lockEnrollment(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Enrollment" WHERE "id" = ${id} FOR UPDATE`,
    );
  }
}
