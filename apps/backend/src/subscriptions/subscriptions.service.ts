import { CLOCK, Clock } from '../time/clock';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import {
  calculateFinancialSummary,
  money,
  operationalSubscriptionStatus,
} from '../commercial/commercial-domain';
import { PrismaService } from '../prisma.service';
import {
  CreateSubscriptionDto,
  ListSubscriptionsQueryDto,
  SubscriptionStatusFilter,
} from './dto/subscription.dto';

const subscriptionProjection = {
  id: true,
  studentId: true,
  planId: true,
  planName: true,
  classAllowance: true,
  agreedPrice: true,
  currency: true,
  periodStart: true,
  periodEnd: true,
  status: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  student: { select: { id: true, fullName: true } },
} satisfies Prisma.SubscriptionSelect;

type SubscriptionView = Prisma.SubscriptionGetPayload<{
  select: typeof subscriptionProjection;
}>;

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(dto: CreateSubscriptionDto, actorId: string) {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodStart >= periodEnd) {
      throw new BadRequestException(
        'El inicio del período debe ser anterior al fin',
      );
    }

    try {
      const subscription = await this.prisma.$transaction(async (tx) => {
        await this.lockStudent(tx, dto.studentId);
        const student = await tx.student.findUnique({
          where: { id: dto.studentId },
          select: { id: true, fullName: true, isActive: true },
        });
        if (!student) throw new NotFoundException('Alumna no encontrada');
        if (!student.isActive) {
          throw new ConflictException(
            'No se puede crear una suscripción para una alumna inactiva',
          );
        }

        await this.lockPlan(tx, dto.planId);
        const plan = await tx.plan.findUnique({
          where: { id: dto.planId },
          select: {
            id: true,
            name: true,
            classCount: true,
            price: true,
            currency: true,
            isActive: true,
          },
        });
        if (!plan) throw new NotFoundException('Plan no encontrado');
        if (!plan.isActive) {
          throw new ConflictException('No se puede contratar un plan inactivo');
        }

        const overlap = await tx.subscription.findFirst({
          where: {
            studentId: dto.studentId,
            status: SubscriptionStatus.ACTIVE,
            periodStart: { lt: periodEnd },
            periodEnd: { gt: periodStart },
          },
          select: { id: true },
        });
        if (overlap) {
          throw new ConflictException(
            'La alumna ya tiene una suscripción que se superpone con el período',
          );
        }

        const agreedPrice =
          dto.agreedPrice === undefined
            ? plan.price
            : new Prisma.Decimal(dto.agreedPrice);
        const created = await tx.subscription.create({
          data: {
            studentId: student.id,
            planId: plan.id,
            planName: plan.name,
            classAllowance: plan.classCount,
            agreedPrice,
            currency: plan.currency,
            periodStart,
            periodEnd,
          },
          select: subscriptionProjection,
        });
        await tx.auditLog.create({
          data: {
            actorType: 'ADMIN',
            actorId,
            action: 'SUBSCRIPTION_CREATED',
            entity: 'Subscription',
            entityId: created.id,
            metadata: {
              studentId: student.id,
              planId: plan.id,
              planName: plan.name,
              classAllowance: plan.classCount,
              referencePrice: money(plan.price),
              agreedPrice: money(agreedPrice),
              customPrice: !agreedPrice.equals(plan.price),
              currency: plan.currency,
              periodStart: periodStart.toISOString(),
              periodEnd: periodEnd.toISOString(),
            },
          },
        });
        return created;
      });
      return this.serialize(subscription);
    } catch (error) {
      if (this.isOverlapConstraint(error)) {
        throw new ConflictException(
          'La alumna ya tiene una suscripción que se superpone con el período',
        );
      }
      throw error;
    }
  }

  list(query: ListSubscriptionsQueryDto) {
    return this.listInternal(query);
  }

  async listForStudent(studentId: string, query: ListSubscriptionsQueryDto) {
    const exists = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Alumna no encontrada');
    return this.listInternal(query, studentId);
  }

  async getById(id: string) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const subscription = await tx.subscription.findUnique({
          where: { id },
          select: subscriptionProjection,
        });
        if (!subscription) {
          throw new NotFoundException('Suscripción no encontrada');
        }
        const payments = await tx.payment.findMany({
          where: { subscriptionId: id },
          select: { amount: true, status: true },
        });
        return { subscription, payments };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      ...this.serialize(result.subscription),
      financialSummary: calculateFinancialSummary(
        result.subscription.agreedPrice,
        result.subscription.currency,
        result.payments,
      ),
    };
  }

  async financialSummary(id: string) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const subscription = await tx.subscription.findUnique({
          where: { id },
          select: { agreedPrice: true, currency: true },
        });
        if (!subscription) {
          throw new NotFoundException('Suscripción no encontrada');
        }
        const payments = await tx.payment.findMany({
          where: { subscriptionId: id },
          select: { amount: true, status: true },
        });
        return { subscription, payments };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return calculateFinancialSummary(
      result.subscription.agreedPrice,
      result.subscription.currency,
      result.payments,
    );
  }

  async cancel(id: string, actorId: string) {
    const subscription = await this.prisma.$transaction(async (tx) => {
      await this.lockSubscription(tx, id);
      const current = await tx.subscription.findUnique({
        where: { id },
        select: subscriptionProjection,
      });
      if (!current) {
        throw new NotFoundException('Suscripción no encontrada');
      }
      if (current.status === SubscriptionStatus.CANCELLED) return current;
      const cancelledAt = this.clock.now();
      const updated = await tx.subscription.update({
        where: { id },
        data: { status: SubscriptionStatus.CANCELLED, cancelledAt },
        select: subscriptionProjection,
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId,
          action: 'SUBSCRIPTION_CANCELLED',
          entity: 'Subscription',
          entityId: id,
          metadata: { cancelledAt: cancelledAt.toISOString() },
        },
      });
      return updated;
    });
    return this.serialize(subscription);
  }

  private async listInternal(
    query: ListSubscriptionsQueryDto,
    studentId?: string,
  ) {
    const now = new Date();
    const statusWhere: Prisma.SubscriptionWhereInput =
      query.status === SubscriptionStatusFilter.ACTIVE
        ? { status: SubscriptionStatus.ACTIVE, periodEnd: { gt: now } }
        : query.status === SubscriptionStatusFilter.EXPIRED
          ? { status: SubscriptionStatus.ACTIVE, periodEnd: { lte: now } }
          : query.status === SubscriptionStatusFilter.CANCELLED
            ? { status: SubscriptionStatus.CANCELLED }
            : {};
    const where: Prisma.SubscriptionWhereInput = {
      ...statusWhere,
      ...(studentId ? { studentId } : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const result = await this.prisma.$transaction(
      async (tx) => {
        const total = await tx.subscription.count({ where });
        const items = await tx.subscription.findMany({
          where,
          select: subscriptionProjection,
          orderBy: [{ periodStart: 'desc' }, { id: 'asc' }],
          skip,
          take: query.limit,
        });
        return { total, items };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items: result.items.map((item) => this.serialize(item, now)),
      meta: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit),
      },
    };
  }

  private serialize(subscription: SubscriptionView, now = new Date()) {
    const { status, ...publicFields } = subscription;
    return {
      ...publicFields,
      agreedPrice: money(subscription.agreedPrice),
      operationalStatus: operationalSubscriptionStatus(
        status,
        subscription.periodEnd,
        now,
      ),
    };
  }

  private isOverlapConstraint(error: unknown) {
    return (
      error instanceof Error &&
      error.message.includes('Subscription_no_active_overlap')
    );
  }

  private async lockStudent(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Student" WHERE "id" = ${id} FOR UPDATE`,
    );
  }

  private async lockPlan(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Plan" WHERE "id" = ${id} FOR UPDATE`,
    );
  }

  private async lockSubscription(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Subscription" WHERE "id" = ${id} FOR UPDATE`,
    );
  }
}
