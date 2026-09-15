import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Payment, PaymentStatus, Prisma } from '@prisma/client';
import { money } from '../commercial/commercial-domain';
import { PrismaService } from '../prisma.service';
import {
  ListPaymentsQueryDto,
  PaymentStatusFilter,
  RegisterPaymentDto,
  VoidPaymentDto,
} from './dto/payment.dto';

const paymentProjection = {
  id: true,
  subscriptionId: true,
  createdByAdminId: true,
  voidedByAdminId: true,
  amount: true,
  currency: true,
  status: true,
  paidAt: true,
  method: true,
  note: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PaymentSelect;

type PaymentView = Pick<Payment, keyof typeof paymentProjection>;

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async register(
    subscriptionId: string,
    dto: RegisterPaymentDto,
    actorId: string,
    idempotencyKey: string,
  ) {
    if (
      typeof idempotencyKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        idempotencyKey,
      )
    ) {
      throw new BadRequestException(
        'Idempotency-Key debe ser un UUID v4 válido',
      );
    }
    const paidAt = new Date(dto.paidAt);
    if (paidAt.getTime() > Date.now()) {
      throw new BadRequestException('paidAt no puede estar en el futuro');
    }
    const amount = new Prisma.Decimal(dto.amount);

    try {
      const payment = await this.prisma.$transaction(async (tx) => {
        await this.lockSubscription(tx, subscriptionId);
        const subscription = await tx.subscription.findUnique({
          where: { id: subscriptionId },
          select: { id: true, agreedPrice: true, currency: true },
        });
        if (!subscription) {
          throw new NotFoundException('Suscripción no encontrada');
        }

        const replay = await tx.payment.findUnique({
          where: { idempotencyKey },
          select: { ...paymentProjection, idempotencyKey: true },
        });
        if (replay) {
          if (
            replay.subscriptionId !== subscriptionId ||
            replay.createdByAdminId !== actorId ||
            !replay.amount.equals(amount) ||
            replay.paidAt.getTime() !== paidAt.getTime() ||
            replay.method !== (dto.method ?? null) ||
            replay.note !== (dto.note ?? null)
          ) {
            throw new ConflictException(
              'La clave de idempotencia ya fue usada con otros datos',
            );
          }
          return replay;
        }

        const aggregate = await tx.payment.aggregate({
          where: {
            subscriptionId,
            status: PaymentStatus.CONFIRMED,
          },
          _sum: { amount: true },
        });
        const paid = aggregate._sum.amount ?? new Prisma.Decimal(0);
        const remaining = subscription.agreedPrice.minus(paid);
        if (amount.greaterThan(remaining)) {
          throw new ConflictException(
            'El pago supera el saldo pendiente de la suscripción',
          );
        }

        const created = await tx.payment.create({
          data: {
            subscriptionId,
            createdByAdminId: actorId,
            idempotencyKey,
            amount,
            currency: subscription.currency,
            paidAt,
            method: dto.method,
            note: dto.note,
          },
          select: paymentProjection,
        });
        await tx.auditLog.create({
          data: {
            actorType: 'ADMIN',
            actorId,
            action: 'PAYMENT_REGISTERED',
            entity: 'Payment',
            entityId: created.id,
            metadata: {
              subscriptionId,
              amount: money(amount),
              currency: created.currency,
              paidAt: paidAt.toISOString(),
              method: created.method,
            },
          },
        });
        return created;
      });
      return this.serialize(payment);
    } catch (error) {
      if (this.isIdempotencyConflict(error)) {
        const existing = await this.prisma.payment.findUnique({
          where: { idempotencyKey },
          select: { ...paymentProjection, idempotencyKey: true },
        });
        if (
          existing &&
          existing.subscriptionId === subscriptionId &&
          existing.createdByAdminId === actorId &&
          existing.amount.equals(amount) &&
          existing.paidAt.getTime() === paidAt.getTime() &&
          existing.method === (dto.method ?? null) &&
          existing.note === (dto.note ?? null)
        ) {
          return this.serialize(existing);
        }
        throw new ConflictException(
          'La clave de idempotencia ya fue usada con otros datos',
        );
      }
      throw error;
    }
  }

  list(query: ListPaymentsQueryDto) {
    return this.listInternal(query);
  }

  async listForSubscription(
    subscriptionId: string,
    query: ListPaymentsQueryDto,
  ) {
    const exists = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Suscripción no encontrada');
    return this.listInternal(query, subscriptionId);
  }

  async getById(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      select: paymentProjection,
    });
    if (!payment) throw new NotFoundException('Pago no encontrado');
    return this.serialize(payment);
  }

  async void(id: string, dto: VoidPaymentDto, actorId: string) {
    const identity = await this.prisma.payment.findUnique({
      where: { id },
      select: { subscriptionId: true },
    });
    if (!identity) throw new NotFoundException('Pago no encontrado');

    const payment = await this.prisma.$transaction(async (tx) => {
      await this.lockSubscription(tx, identity.subscriptionId);
      await this.lockPayment(tx, id);
      const current = await tx.payment.findUnique({
        where: { id },
        select: paymentProjection,
      });
      if (!current) throw new NotFoundException('Pago no encontrado');
      if (current.status === PaymentStatus.VOIDED) return current;
      const voidedAt = new Date();
      const updated = await tx.payment.update({
        where: { id },
        data: {
          status: PaymentStatus.VOIDED,
          voidedAt,
          voidedByAdminId: actorId,
          voidReason: dto.reason,
        },
        select: paymentProjection,
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId,
          action: 'PAYMENT_VOIDED',
          entity: 'Payment',
          entityId: id,
          metadata: {
            subscriptionId: current.subscriptionId,
            amount: money(current.amount),
            currency: current.currency,
            reason: dto.reason,
            voidedAt: voidedAt.toISOString(),
          },
        },
      });
      return updated;
    });
    return this.serialize(payment);
  }

  private async listInternal(
    query: ListPaymentsQueryDto,
    subscriptionId?: string,
  ) {
    const where: Prisma.PaymentWhereInput = {
      ...(subscriptionId ? { subscriptionId } : {}),
      ...(query.status === PaymentStatusFilter.ALL
        ? {}
        : {
            status:
              query.status === PaymentStatusFilter.CONFIRMED
                ? PaymentStatus.CONFIRMED
                : PaymentStatus.VOIDED,
          }),
    };
    const skip = (query.page - 1) * query.limit;
    const result = await this.prisma.$transaction(
      async (tx) => {
        const total = await tx.payment.count({ where });
        const items = await tx.payment.findMany({
          where,
          select: paymentProjection,
          orderBy: [{ paidAt: 'desc' }, { id: 'asc' }],
          skip,
          take: query.limit,
        });
        return { total, items };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items: result.items.map((payment) => this.serialize(payment)),
      meta: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit),
      },
    };
  }

  private serialize(payment: PaymentView & { idempotencyKey?: string }) {
    const { idempotencyKey, ...publicFields } = payment;
    void idempotencyKey;
    return { ...publicFields, amount: money(payment.amount) };
  }

  private isIdempotencyConflict(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      String(error.meta?.target).includes('idempotencyKey')
    );
  }

  private async lockSubscription(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Subscription" WHERE "id" = ${id} FOR UPDATE`,
    );
  }

  private async lockPayment(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Payment" WHERE "id" = ${id} FOR UPDATE`,
    );
  }
}
