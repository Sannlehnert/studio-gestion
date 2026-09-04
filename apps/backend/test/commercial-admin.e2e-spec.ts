import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service';
import {
  activationToken,
  createAdmin,
  createTestApp,
  FRONTEND_ORIGIN,
  loginAdmin,
  sessionCookie,
} from './helpers';

describe('Commercial Admin API with PostgreSQL (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let adminCookie: string;
  let studentCookie: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    const credentials = await createAdmin(app, prisma);
    adminCookie = sessionCookie(
      await loginAdmin(app, credentials.admin.email, credentials.password),
    );
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const mutate = (
    method: 'post' | 'patch',
    path: string,
    body?: object,
    cookie = adminCookie,
  ) => {
    const operation = request(app.getHttpServer())
      [method]('/api/v1' + path)
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', cookie);
    return body === undefined ? operation : operation.send(body);
  };

  async function createStudent(name: string) {
    return (
      await mutate('post', '/admin/students', { fullName: name }).expect(201)
    ).body as { id: string; fullName: string };
  }

  async function createPlan(price = '40000.00') {
    return (
      await mutate('post', '/admin/plans', {
        name: '8 clases ' + randomUUID(),
        description: 'Plan mensual',
        classCount: 8,
        price,
        currency: 'ARS',
      }).expect(201)
    ).body as {
      id: string;
      name: string;
      classCount: number;
      price: string;
    };
  }

  it('runs the complete snapshot and partial-payment flow', async () => {
    const student = await createStudent('Martina ' + randomUUID());
    const plan = await createPlan();
    const subscription = await mutate('post', '/admin/subscriptions', {
      studentId: student.id,
      planId: plan.id,
      periodStart: '2099-09-01T00:00:00-03:00',
      periodEnd: '2099-10-01T00:00:00-03:00',
      agreedPrice: '35000.00',
    }).expect(201);
    expect(subscription.body).toMatchObject({
      studentId: student.id,
      planId: plan.id,
      planName: plan.name,
      classAllowance: 8,
      agreedPrice: '35000.00',
      currency: 'ARS',
      operationalStatus: 'ACTIVE',
    });

    const paidAt = new Date(Date.now() - 60_000).toISOString();
    const firstKey = randomUUID();
    const first = await mutate(
      'post',
      '/admin/subscriptions/' + subscription.body.id + '/payments',
      { amount: '20000.00', paidAt, method: 'TRANSFER' },
    )
      .set('Idempotency-Key', firstKey)
      .expect(201);
    expect(first.body).not.toHaveProperty('idempotencyKey');

    await request(app.getHttpServer())
      .get(
        '/api/v1/admin/subscriptions/' +
          subscription.body.id +
          '/financial-summary',
      )
      .set('Cookie', adminCookie)
      .expect(200)
      .expect({
        agreedAmount: '35000.00',
        paidAmount: '20000.00',
        remainingAmount: '15000.00',
        status: 'PARTIAL',
        currency: 'ARS',
      });

    await mutate(
      'post',
      '/admin/subscriptions/' + subscription.body.id + '/payments',
      { amount: '15000.00', paidAt },
    )
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await request(app.getHttpServer())
      .get(
        '/api/v1/admin/subscriptions/' +
          subscription.body.id +
          '/financial-summary',
      )
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('PAID'));

    await mutate('patch', '/admin/plans/' + plan.id, {
      name: '12 clases actual',
      classCount: 12,
      price: '50000.00',
    }).expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/admin/subscriptions/' + subscription.body.id)
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.planName).toBe(plan.name);
        expect(body.classAllowance).toBe(8);
        expect(body.agreedPrice).toBe('35000.00');
      });

    await mutate('post', '/admin/plans/' + plan.id + '/deactivate').expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/admin/subscriptions/' + subscription.body.id)
      .set('Cookie', adminCookie)
      .expect(200);
    await mutate('post', '/admin/subscriptions', {
      studentId: student.id,
      planId: plan.id,
      periodStart: '2099-10-01T00:00:00-03:00',
      periodEnd: '2099-11-01T00:00:00-03:00',
    }).expect(409);

    const byStudent = await request(app.getHttpServer())
      .get('/api/v1/admin/students/' + student.id + '/subscriptions')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(byStudent.body.items.map((item: { id: string }) => item.id)).toEqual(
      [subscription.body.id],
    );
  });

  it('rejects overlap, overpayment, replay changes and unsafe input', async () => {
    const student = await createStudent('Reglas ' + randomUUID());
    const plan = await createPlan('100.00');
    const subscription = await mutate('post', '/admin/subscriptions', {
      studentId: student.id,
      planId: plan.id,
      periodStart: '2098-01-01T00:00:00Z',
      periodEnd: '2098-02-01T00:00:00Z',
    }).expect(201);
    await mutate('post', '/admin/subscriptions', {
      studentId: student.id,
      planId: plan.id,
      periodStart: '2098-01-15T00:00:00Z',
      periodEnd: '2098-02-15T00:00:00Z',
    }).expect(409);

    const paidAt = new Date(Date.now() - 60_000).toISOString();
    const key = randomUUID();
    const payment = await mutate(
      'post',
      '/admin/subscriptions/' + subscription.body.id + '/payments',
      { amount: '60.00', paidAt, note: 'Entrega' },
    )
      .set('Idempotency-Key', key)
      .expect(201);
    await mutate(
      'post',
      '/admin/subscriptions/' + subscription.body.id + '/payments',
      { amount: '60.00', paidAt, note: 'Entrega' },
    )
      .set('Idempotency-Key', key)
      .expect(201)
      .expect(({ body }) => {
        expect(body.id).toBe(payment.body.id);
        expect(body).not.toHaveProperty('idempotencyKey');
      });
    await mutate(
      'post',
      '/admin/subscriptions/' + subscription.body.id + '/payments',
      { amount: '61.00', paidAt, note: 'Entrega' },
    )
      .set('Idempotency-Key', key)
      .expect(409);
    await mutate(
      'post',
      '/admin/subscriptions/' + subscription.body.id + '/payments',
      { amount: '40.01', paidAt },
    )
      .set('Idempotency-Key', randomUUID())
      .expect(409);

    await mutate('post', '/admin/payments/' + payment.body.id + '/void', {
      reason: 'Importe registrado por error',
    })
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('VOIDED');
        expect(body.voidReason).toBe('Importe registrado por error');
      });
    await mutate('post', '/admin/payments/' + payment.body.id + '/void', {
      reason: 'Reintento idempotente',
    }).expect(200);

    for (const invalid of [
      {
        name: 'Precio negativo',
        classCount: 8,
        price: '-1',
      },
      {
        name: 'Importe numérico',
        classCount: 8,
        price: 100,
      },
      {
        name: 'Moneda inválida',
        classCount: 8,
        price: '100.00',
        currency: 'USD',
      },
      {
        name: 'Campo extra',
        classCount: 8,
        price: '100.00',
        createdAt: '2026-01-01',
      },
    ]) {
      await mutate('post', '/admin/plans', invalid).expect(400);
    }
    await mutate(
      'post',
      '/admin/subscriptions/' + subscription.body.id + '/payments',
      { amount: '0.001', paidAt },
    )
      .set('Idempotency-Key', randomUUID())
      .expect(400);
    await mutate(
      'post',
      '/admin/subscriptions/' + subscription.body.id + '/payments',
      { amount: '1.00', currency: 'ARS', paidAt },
    )
      .set('Idempotency-Key', randomUUID())
      .expect(400);
    await mutate(
      'post',
      '/admin/subscriptions/' + subscription.body.id + '/payments',
      { amount: '1.00', paidAt },
    ).expect(400);

    await mutate(
      'post',
      '/admin/students/' + student.id + '/deactivate',
    ).expect(200);
    await mutate('post', '/admin/subscriptions', {
      studentId: student.id,
      planId: plan.id,
      periodStart: '2098-02-01T00:00:00Z',
      periodEnd: '2098-03-01T00:00:00Z',
    }).expect(409);
  });

  it('enforces Admin authorization on every commercial surface', async () => {
    const student = await createStudent('Acceso ' + randomUUID());
    const access = await mutate(
      'post',
      '/admin/students/' + student.id + '/access',
      {},
    ).expect(201);
    studentCookie = sessionCookie(
      await request(app.getHttpServer())
        .post('/api/v1/auth/student/activate')
        .set('Origin', FRONTEND_ORIGIN)
        .send({ token: activationToken(access) })
        .expect(200),
    );
    for (const path of [
      '/api/v1/admin/plans',
      '/api/v1/admin/subscriptions',
      '/api/v1/admin/payments',
    ]) {
      await request(app.getHttpServer()).get(path).expect(401);
      await request(app.getHttpServer())
        .get(path)
        .set('Cookie', studentCookie)
        .expect(403);
    }
    await mutate(
      'post',
      '/admin/plans',
      { name: 'Intento', classCount: 8, price: '10.00' },
      studentCookie,
    ).expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/admin/plans')
      .set('Cookie', adminCookie)
      .send({ name: 'Sin CSRF', classCount: 8, price: '10.00' })
      .expect(403);
  });

  it('publishes the implemented OpenAPI and no destructive endpoints', async () => {
    const schema = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(schema.body.paths['/api/v1/admin/plans'].post).toBeDefined();
    expect(
      schema.body.paths['/api/v1/admin/plans/{id}'].delete,
    ).toBeUndefined();
    expect(
      schema.body.paths['/api/v1/admin/subscriptions/{id}'].patch,
    ).toBeUndefined();
    expect(
      schema.body.paths['/api/v1/admin/payments/{id}'].delete,
    ).toBeUndefined();
    const register =
      schema.body.paths['/api/v1/admin/subscriptions/{subscriptionId}/payments']
        .post;
    expect(
      register.parameters.find(
        (parameter: { name: string }) =>
          parameter.name.toLowerCase() === 'idempotency-key',
      ).required,
    ).toBe(true);
    expect(
      schema.body.components.schemas.FinancialSummaryResponseDto.properties
        .agreedAmount.type,
    ).toBe('string');
  });
});
