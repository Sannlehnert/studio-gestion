import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Schedule, SubscriptionStatus } from '@prisma/client';
import {
  intervalHasWeekday,
  maximumConcurrentEnrollments,
} from '../enrollments/enrollment-domain';
import { PrismaService } from '../prisma.service';
import { BusinessTimeService } from '../time/business-time.service';
import {
  databaseDateToLocalDate,
  localDateToDatabaseDate,
  minuteToTime,
  timeToMinute,
} from '../time/business-time';
import {
  CreateScheduleDto,
  ListSchedulesQueryDto,
  ScheduleStatusFilter,
  UpdateScheduleDto,
} from './dto/schedule.dto';

const scheduleProjection = {
  id: true,
  dayOfWeek: true,
  startMinute: true,
  endMinute: true,
  defaultCapacity: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ScheduleSelect;

type ScheduleView = Pick<Schedule, keyof typeof scheduleProjection>;

@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessTime: BusinessTimeService,
  ) {}

  async create(dto: CreateScheduleDto, actorId: string) {
    const startMinute = timeToMinute(dto.startTime);
    const endMinute = timeToMinute(dto.endTime);
    this.assertTimeRange(startMinute, endMinute);
    const schedule = await this.prisma.$transaction(async (tx) => {
      const created = await tx.schedule.create({
        data: {
          dayOfWeek: dto.dayOfWeek,
          startMinute,
          endMinute,
          defaultCapacity: dto.defaultCapacity,
        },
        select: scheduleProjection,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'SCHEDULE_CREATED',
          entity: 'Schedule',
          entityId: created.id,
          metadata: this.auditSnapshot(created),
        },
      });
      return created;
    });
    return this.serialize(schedule);
  }

  async list(query: ListSchedulesQueryDto) {
    const where: Prisma.ScheduleWhereInput = {
      ...(query.status === ScheduleStatusFilter.ALL
        ? {}
        : { isActive: query.status === ScheduleStatusFilter.ACTIVE }),
      ...(query.dayOfWeek === undefined ? {} : { dayOfWeek: query.dayOfWeek }),
    };
    const skip = (query.page - 1) * query.limit;
    const result = await this.prisma.$transaction(
      async (tx) => {
        const total = await tx.schedule.count({ where });
        const items = await tx.schedule.findMany({
          where,
          select: scheduleProjection,
          orderBy: [
            { dayOfWeek: 'asc' },
            { startMinute: 'asc' },
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
      meta: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit),
      },
    };
  }

  async getById(id: string) {
    const schedule = await this.prisma.schedule.findUnique({
      where: { id },
      select: scheduleProjection,
    });
    if (!schedule) throw new NotFoundException('Horario no encontrado');
    return this.serialize(schedule);
  }

  async update(id: string, dto: UpdateScheduleDto, actorId: string) {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException('Debe indicar al menos un campo editable');
    }
    const schedule = await this.prisma.$transaction(async (tx) => {
      await this.lockSchedule(tx, id);
      const before = await tx.schedule.findUnique({
        where: { id },
        select: scheduleProjection,
      });
      if (!before) throw new NotFoundException('Horario no encontrado');
      const startMinute =
        dto.startTime === undefined
          ? before.startMinute
          : timeToMinute(dto.startTime);
      const endMinute =
        dto.endTime === undefined
          ? before.endMinute
          : timeToMinute(dto.endTime);
      this.assertTimeRange(startMinute, endMinute);
      const defaultCapacity = dto.defaultCapacity ?? before.defaultCapacity;
      const dayOfWeek = dto.dayOfWeek ?? before.dayOfWeek;
      if (
        defaultCapacity < before.defaultCapacity ||
        dayOfWeek !== before.dayOfWeek
      ) {
        await this.assertFutureEnrollmentCompatibility(
          tx,
          id,
          dayOfWeek,
          defaultCapacity,
        );
      }
      const data: Prisma.ScheduleUpdateInput = {
        ...(dto.dayOfWeek === undefined ? {} : { dayOfWeek: dto.dayOfWeek }),
        ...(dto.startTime === undefined ? {} : { startMinute }),
        ...(dto.endTime === undefined ? {} : { endMinute }),
        ...(dto.defaultCapacity === undefined ? {} : { defaultCapacity }),
      };
      const changed =
        (dto.dayOfWeek !== undefined && dto.dayOfWeek !== before.dayOfWeek) ||
        (dto.startTime !== undefined && startMinute !== before.startMinute) ||
        (dto.endTime !== undefined && endMinute !== before.endMinute) ||
        (dto.defaultCapacity !== undefined &&
          defaultCapacity !== before.defaultCapacity);
      if (!changed) return before;
      const updated = await tx.schedule.update({
        where: { id },
        data,
        select: scheduleProjection,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'SCHEDULE_UPDATED',
          entity: 'Schedule',
          entityId: id,
          metadata: {
            before: this.auditSnapshot(before),
            after: this.auditSnapshot(updated),
          },
        },
      });
      return updated;
    });
    return this.serialize(schedule);
  }

  activate(id: string, actorId: string) {
    return this.setActive(id, true, actorId);
  }

  deactivate(id: string, actorId: string) {
    return this.setActive(id, false, actorId);
  }

  private async setActive(id: string, isActive: boolean, actorId: string) {
    const schedule = await this.prisma.$transaction(async (tx) => {
      await this.lockSchedule(tx, id);
      const current = await tx.schedule.findUnique({
        where: { id },
        select: scheduleProjection,
      });
      if (!current) throw new NotFoundException('Horario no encontrado');
      if (current.isActive === isActive) return current;
      const updated = await tx.schedule.update({
        where: { id },
        data: { isActive },
        select: scheduleProjection,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: isActive ? 'SCHEDULE_ACTIVATED' : 'SCHEDULE_DEACTIVATED',
          entity: 'Schedule',
          entityId: id,
        },
      });
      return updated;
    });
    return this.serialize(schedule);
  }

  private async assertFutureEnrollmentCompatibility(
    tx: Prisma.TransactionClient,
    scheduleId: string,
    dayOfWeek: number,
    capacity: number,
  ) {
    const today = this.businessTime.today();
    const rows = await tx.enrollment.findMany({
      where: {
        scheduleId,
        validUntil: { gt: localDateToDatabaseDate(today) },
        subscription: { status: SubscriptionStatus.ACTIVE },
      },
      select: { validFrom: true, validUntil: true },
    });
    const intervals = rows.map((row) => ({
      validFrom:
        databaseDateToLocalDate(row.validFrom) < today
          ? today
          : databaseDateToLocalDate(row.validFrom),
      validUntil: databaseDateToLocalDate(row.validUntil),
    }));
    if (
      intervals.some(
        (interval) =>
          !intervalHasWeekday(
            interval.validFrom,
            interval.validUntil,
            dayOfWeek,
          ),
      )
    ) {
      throw new ConflictException(
        'El nuevo día deja una inscripción futura sin ninguna clase posible',
      );
    }
    if (maximumConcurrentEnrollments(intervals) > capacity) {
      throw new ConflictException(
        'La capacidad es menor que las inscripciones futuras vigentes',
      );
    }
  }

  private assertTimeRange(startMinute: number, endMinute: number) {
    if (startMinute >= endMinute) {
      throw new BadRequestException(
        'La hora de inicio debe ser anterior a la hora de fin',
      );
    }
  }

  private serialize(schedule: ScheduleView) {
    const { startMinute, endMinute, ...publicFields } = schedule;
    return {
      ...publicFields,
      startTime: minuteToTime(startMinute),
      endTime: minuteToTime(endMinute),
    };
  }

  private auditSnapshot(schedule: ScheduleView) {
    return {
      dayOfWeek: schedule.dayOfWeek,
      startTime: minuteToTime(schedule.startMinute),
      endTime: minuteToTime(schedule.endMinute),
      defaultCapacity: schedule.defaultCapacity,
    };
  }

  private async lockSchedule(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Schedule" WHERE "id" = ${id} FOR UPDATE`,
    );
  }
}
