import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { PaymentStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import { PaymentsService } from '../src/payments/payments.service';
import { PlansService } from '../src/plans/plans.service';
import { PrismaService } from '../src/prisma.service';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { StudentsService } from '../src/students/students.service';
import { createAdmin, createTestApp } from './helpers';

describe('Commercial persistence with PostgreSQL (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let plans: PlansService;
  let subscriptions: SubscriptionsService;
  let payments: PaymentsService;
  let students: StudentsService;
  let actorId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    plans = app.get(PlansService);
    subscriptions = app.get(SubscriptionsService);
    payments = app.get(PaymentsService);
    students = app.get(StudentsService);
    actorId = (await createAdmin(app, prisma)).admin.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function commercialFixture(price = '40000.00') {
    const student = await prisma.student.create({
      data: { fullName: 'Comercial ' + randomUUID() },
    });
    const plan = await plans.create(
      {
        name: 'Plan ' + randomUUID(),
        description: 'Modalidad de integración',
        classCount: 8,
        price,
        currency: 'ARS',
      },
      actorId,
    );
    return { student, plan };
  }

  it('preserves the subscription snapshot across plan edits and deactivation', async () => {
    const { student, plan } = await commercialFixture();
    const subscription = await subscriptions.create(
      {
        studentId: student.id,
        planId: plan.id,
        periodStart: '2099-09-01T00:00:00-03:00',
        periodEnd: '2099-10-01T00:00:00-03:00',
        agreedPrice: '35000.00',
      },
      actorId,
    );

    await plans.update(
      plan.id,
      { name: 'Plan actualizado', classCount: 12, price: '50000.00' },
      actorId,
    );
    await plans.deactivate(plan.id, actorId);
    const stored = await subscriptions.getById(subscription.id);
    expect(stored).toMatchObject({
      planName: plan.name,
      classAllowance: 8,
      agreedPrice: '35000.00',
      currency: 'ARS',
      operationalStatus: 'ACTIVE',
    });
    await expect(
      subscriptions.create(
        {
          studentId: student.id,
          planId: plan.id,
          periodStart: '2099-10-01T00:00:00-03:00',
          periodEnd: '2099-11-01T00:00:00-03:00',
        },
        actorId,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await prisma.auditLog.count({
        where: { action: 'SUBSCRIPTION_CREATED', entityId: subscription.id },
      }),
    ).toBe(1);
  });

  it('supports partial payments, safe replay, voiding and derived totals', async () => {
    const { student, plan } = await commercialFixture('100.00');
    const subscription = await subscriptions.create(
      {
        studentId: student.id,
        planId: plan.id,
        periodStart: '2098-01-01T00:00:00Z',
        periodEnd: '2098-02-01T00:00:00Z',
      },
      actorId,
    );
    const paidAt = new Date(Date.now() - 1000).toISOString();
    const key = randomUUID();
    const first = await payments.register(
      subscription.id,
      { amount: '40.10', paidAt, method: 'TRANSFER', note: 'Primera parte' },
      actorId,
      key,
    );
    const replay = await payments.register(
      subscription.id,
      { amount: '40.10', paidAt, method: 'TRANSFER', note: 'Primera parte' },
      actorId,
      key,
    );
    expect(replay.id).toBe(first.id);
    expect(await subscriptions.financialSummary(subscription.id)).toEqual({
      agreedAmount: '100.00',
      paidAmount: '40.10',
      remainingAmount: '59.90',
      status: 'PARTIAL',
      currency: 'ARS',
    });
    await expect(
      payments.register(
        subscription.id,
        { amount: '60.00', paidAt },
        actorId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });

    await payments.void(
      first.id,
      { reason: 'Carga de importe incorrecta' },
      actorId,
    );
    await payments.void(
      first.id,
      { reason: 'Segundo intento idempotente' },
      actorId,
    );
    expect(await subscriptions.financialSummary(subscription.id)).toMatchObject(
      {
        paidAmount: '0.00',
        remainingAmount: '100.00',
        status: 'PENDING',
      },
    );
    expect(
      await prisma.auditLog.count({
        where: { action: 'PAYMENT_REGISTERED', entityId: first.id },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'PAYMENT_VOIDED', entityId: first.id },
      }),
    ).toBe(1);
  });

  it('serializes concurrent subscriptions, payments and void requests', async () => {
    const { student, plan } = await commercialFixture('100.00');
    const create = () =>
      subscriptions.create(
        {
          studentId: student.id,
          planId: plan.id,
          periodStart: '2097-01-01T00:00:00Z',
          periodEnd: '2097-02-01T00:00:00Z',
        },
        actorId,
      );
    const subscriptionResults = await Promise.allSettled([create(), create()]);
    expect(
      subscriptionResults.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      subscriptionResults.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const subscription = (
      subscriptionResults.find(
        (result) => result.status === 'fulfilled',
      ) as PromiseFulfilledResult<{ id: string }>
    ).value;

    const paidAt = new Date(Date.now() - 1000).toISOString();
    const paymentResults = await Promise.allSettled([
      payments.register(
        subscription.id,
        { amount: '60.00', paidAt },
        actorId,
        randomUUID(),
      ),
      payments.register(
        subscription.id,
        { amount: '60.00', paidAt },
        actorId,
        randomUUID(),
      ),
    ]);
    expect(
      paymentResults.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      paymentResults.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const payment = (
      paymentResults.find(
        (result) => result.status === 'fulfilled',
      ) as PromiseFulfilledResult<{ id: string }>
    ).value;

    const voidResults = await Promise.all([
      payments.void(payment.id, { reason: 'Corrección concurrente' }, actorId),
      payments.void(payment.id, { reason: 'Reintento concurrente' }, actorId),
    ]);
    expect(voidResults.map((result) => result.status)).toEqual([
      PaymentStatus.VOIDED,
      PaymentStatus.VOIDED,
    ]);
    expect(
      await prisma.auditLog.count({
        where: { action: 'PAYMENT_VOIDED', entityId: payment.id },
      }),
    ).toBe(1);
  });

  it('enforces monetary, period and overlap invariants in PostgreSQL', async () => {
    await expect(
      prisma.plan.create({
        data: {
          name: 'Precio inválido',
          classCount: 8,
          price: new Prisma.Decimal('-0.01'),
          currency: 'ARS',
        },
      }),
    ).rejects.toThrow();

    const { student, plan } = await commercialFixture();
    const first = await subscriptions.create(
      {
        studentId: student.id,
        planId: plan.id,
        periodStart: '2096-01-01T00:00:00Z',
        periodEnd: '2096-02-01T00:00:00Z',
      },
      actorId,
    );
    await expect(
      prisma.subscription.create({
        data: {
          studentId: student.id,
          planId: plan.id,
          planName: plan.name,
          classAllowance: plan.classCount,
          agreedPrice: new Prisma.Decimal(plan.price),
          currency: 'ARS',
          periodStart: new Date('2096-01-15T00:00:00Z'),
          periodEnd: new Date('2096-02-15T00:00:00Z'),
          status: SubscriptionStatus.ACTIVE,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.payment.create({
        data: {
          subscriptionId: first.id,
          createdByAdminId: actorId,
          idempotencyKey: randomUUID(),
          amount: new Prisma.Decimal('-1'),
          currency: 'ARS',
          paidAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects inactive students before creating a contract', async () => {
    const { student, plan } = await commercialFixture();
    await students.deactivate(student.id, actorId);
    await expect(
      subscriptions.create(
        {
          studentId: student.id,
          planId: plan.id,
          periodStart: '2095-01-01T00:00:00Z',
          periodEnd: '2095-02-01T00:00:00Z',
        },
        actorId,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
