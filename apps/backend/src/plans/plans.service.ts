import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Plan, Prisma } from '@prisma/client';
import { money } from '../commercial/commercial-domain';
import { PrismaService } from '../prisma.service';
import {
  CreatePlanDto,
  ListPlansQueryDto,
  PlanStatusFilter,
  UpdatePlanDto,
} from './dto/plan.dto';

const planProjection = {
  id: true,
  name: true,
  description: true,
  classCount: true,
  price: true,
  currency: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PlanSelect;

type PlanView = Pick<Plan, keyof typeof planProjection>;

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePlanDto, actorId: string) {
    const price = new Prisma.Decimal(dto.price);
    const plan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.plan.create({
        data: {
          name: dto.name,
          description: dto.description,
          classCount: dto.classCount,
          price,
          currency: dto.currency ?? 'ARS',
        },
        select: planProjection,
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId,
          action: 'PLAN_CREATED',
          entity: 'Plan',
          entityId: created.id,
          metadata: {
            name: created.name,
            classCount: created.classCount,
            price: money(created.price),
            currency: created.currency,
          },
        },
      });
      return created;
    });
    return this.serialize(plan);
  }

  async list(query: ListPlansQueryDto) {
    const where: Prisma.PlanWhereInput = {
      ...(query.status === PlanStatusFilter.ALL
        ? {}
        : { isActive: query.status === PlanStatusFilter.ACTIVE }),
      ...(query.search
        ? {
            name: {
              contains: query.search,
              mode: Prisma.QueryMode.insensitive,
            },
          }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const result = await this.prisma.$transaction(
      async (tx) => {
        const total = await tx.plan.count({ where });
        const items = await tx.plan.findMany({
          where,
          select: planProjection,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip,
          take: query.limit,
        });
        return { total, items };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items: result.items.map((plan) => this.serialize(plan)),
      meta: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit),
      },
    };
  }

  async getById(id: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      select: planProjection,
    });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    return this.serialize(plan);
  }

  async update(id: string, dto: UpdatePlanDto, actorId: string) {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException('Debe indicar al menos un campo editable');
    }
    const plan = await this.prisma.$transaction(async (tx) => {
      await this.lockPlan(tx, id);
      const before = await tx.plan.findUnique({
        where: { id },
        select: planProjection,
      });
      if (!before) throw new NotFoundException('Plan no encontrado');

      const data: Prisma.PlanUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.classCount !== undefined) data.classCount = dto.classCount;
      if (dto.price !== undefined) data.price = new Prisma.Decimal(dto.price);

      const changed =
        (dto.name !== undefined && dto.name !== before.name) ||
        (dto.description !== undefined &&
          dto.description !== before.description) ||
        (dto.classCount !== undefined &&
          dto.classCount !== before.classCount) ||
        (dto.price !== undefined && !before.price.equals(dto.price));
      if (!changed) return before;

      const updated = await tx.plan.update({
        where: { id },
        data,
        select: planProjection,
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId,
          action: 'PLAN_UPDATED',
          entity: 'Plan',
          entityId: id,
          metadata: {
            before: this.auditSnapshot(before),
            after: this.auditSnapshot(updated),
          },
        },
      });
      return updated;
    });
    return this.serialize(plan);
  }

  activate(id: string, actorId: string) {
    return this.setActive(id, true, actorId);
  }

  deactivate(id: string, actorId: string) {
    return this.setActive(id, false, actorId);
  }

  private async setActive(id: string, isActive: boolean, actorId: string) {
    const plan = await this.prisma.$transaction(async (tx) => {
      await this.lockPlan(tx, id);
      const current = await tx.plan.findUnique({
        where: { id },
        select: planProjection,
      });
      if (!current) throw new NotFoundException('Plan no encontrado');
      if (current.isActive === isActive) return current;
      const updated = await tx.plan.update({
        where: { id },
        data: { isActive },
        select: planProjection,
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId,
          action: isActive ? 'PLAN_ACTIVATED' : 'PLAN_DEACTIVATED',
          entity: 'Plan',
          entityId: id,
        },
      });
      return updated;
    });
    return this.serialize(plan);
  }

  private serialize(plan: PlanView) {
    return { ...plan, price: money(plan.price) };
  }

  private auditSnapshot(plan: PlanView) {
    return {
      name: plan.name,
      description: plan.description,
      classCount: plan.classCount,
      price: money(plan.price),
      currency: plan.currency,
    };
  }

  private async lockPlan(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Plan" WHERE "id" = ${id} FOR UPDATE`,
    );
  }
}
