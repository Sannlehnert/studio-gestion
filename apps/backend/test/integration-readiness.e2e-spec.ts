import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service';
import { ClassParticipationService } from '../src/class-sessions/class-participation.service';
import { IntegrationReadsService } from '../src/integration-reads/integration-reads.service';
import {
  createTestApp,
  createAdmin,
  loginAdmin,
  sessionCookie,
  FRONTEND_ORIGIN,
  activationToken,
} from './helpers';
import { qrFixture, QrClock, QR_NOW } from './qr-fixture';

describe('Stage 7.1 PostgreSQL and HTTP contracts', () => {
  const clock = new QrClock();
  let app: NestExpressApplication, prisma: PrismaService, cookie: string;
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
    const admin = await createAdmin(app, prisma);
    cookie = sessionCookie(
      await loginAdmin(app, admin.admin.email, admin.password),
    );
  });
  beforeEach(() => clock.set(QR_NOW));
  afterAll(async () => {
    if (app) await app.close();
  });
  const get = (path: string, auth = cookie) =>
    request(app.getHttpServer())
      .get('/api/v1' + path)
      .set('Cookie', auth);
  const post = (path: string, data: object, auth = cookie) =>
    request(app.getHttpServer())
      .post('/api/v1' + path)
      .set('Cookie', auth)
      .set('Origin', FRONTEND_ORIGIN)
      .send(data);
  async function studentCookie(id: string) {
    const access = await post(`/admin/students/${id}/access`, {}).expect(201);
    return sessionCookie(
      await post(
        '/auth/student/activate',
        { token: activationToken(access) },
        '',
      ).expect(200),
    );
  }
  async function absence() {
    const f = await qrFixture(prisma);
    const a = await post(
      `/admin/class-sessions/${f.session.id}/students/${f.student.id}/attendance`,
      { reason: 'Presencia verificada' },
    ).expect(201);
    await post(`/admin/attendances/${a.body.attendance.id}/corrections`, {
      targetStatus: 'ABSENT',
      reason: 'Registro equivocado',
    }).expect(200);
    return { ...f, attendanceId: a.body.attendance.id };
  }
  async function target(capacity = 1) {
    const schedule = await prisma.schedule.create({
      data: {
        dayOfWeek: 4,
        startMinute: 600,
        endMinute: 660,
        defaultCapacity: capacity,
      },
    });
    return prisma.classSession.create({
      data: {
        scheduleId: schedule.id,
        occurrenceDate: new Date('2035-01-11Z'),
        startAt: new Date('2035-01-11T13:00:00Z'),
        endAt: new Date('2035-01-11T14:00:00Z'),
        capacity,
      },
    });
  }
  it('CURRENT summary is owned, exact, non-financial and keeps auth/me focused', async () => {
    const f = await qrFixture(prisma),
      auth = await studentCookie(f.student.id);
    const home = (await get('/student/home-summary', auth).expect(200)).body;
    expect(home).toMatchObject({
      context: 'CURRENT',
      subscription: {
        subscriptionId: f.subscription.id,
        status: 'ACTIVE',
        classAllowance: 4,
        usedClasses: 0,
        remainingClasses: 4,
      },
      readAt: QR_NOW.toISOString(),
      businessDate: '2035-01-10',
      timeZone: 'America/Argentina/Buenos_Aires',
      nextClass: {
        participationKind: 'REGULAR',
        classSession: { classSessionId: f.session.id },
      },
      nextRecovery: null,
    });
    expect(JSON.stringify(home)).not.toMatch(
      /agreedPrice|paidAmount|financialSummary|source|creationReason|correctedByAdminId/,
    );
    const summary = (
      await get(`/admin/students/${f.student.id}/subscription-summary`).expect(
        200,
      )
    ).body;
    expect(summary.financialSummary).toMatchObject({
      agreedAmount: '100.00',
      paidAmount: '0.00',
      remainingAmount: '100.00',
    });
    expect(Object.keys((await get('/auth/me', auth).expect(200)).body)).toEqual(
      ['user'],
    );
  });
  it('NONE, UPCOMING and exact period boundaries exclude expired/cancelled contracts', async () => {
    const f = await qrFixture(prisma),
      auth = await studentCookie(f.student.id);
    clock.set(f.subscription.periodEnd);
    expect(
      (await get('/student/home-summary', auth).expect(200)).body,
    ).toMatchObject({ context: 'NONE', subscription: null });
    const future = await prisma.subscription.create({
      data: {
        studentId: f.student.id,
        planId: f.subscription.planId,
        planName: 'Future',
        currency: 'ARS',
        agreedPrice: '50.00',
        classAllowance: 2,
        periodStart: new Date('2035-03-01Z'),
        periodEnd: new Date('2035-04-01Z'),
      },
    });
    expect(
      (await get('/student/home-summary', auth).expect(200)).body,
    ).toMatchObject({
      context: 'UPCOMING',
      subscription: {
        subscriptionId: future.id,
        status: 'ACTIVE',
        usedClasses: 0,
      },
    });
    clock.set(future.periodStart);
    expect(
      (await get('/student/home-summary', auth).expect(200)).body.context,
    ).toBe('CURRENT');
    await post(`/admin/subscriptions/${future.id}/cancel`, {}).expect(200);
    expect(
      (await get('/student/home-summary', auth).expect(200)).body.context,
    ).toBe('NONE');
  });
  it('empty Student has NONE and empty history without a manufactured allowance', async () => {
    const student = await prisma.student.create({
      data: { fullName: 'No subscription ' + randomUUID() },
    });
    const auth = await studentCookie(student.id);
    expect(
      (await get('/student/home-summary', auth).expect(200)).body,
    ).toMatchObject({
      context: 'NONE',
      subscription: null,
      nextClass: null,
      nextRecovery: null,
    });
    expect(
      (await get('/student/attendance-history', auth).expect(200)).body,
    ).toEqual({
      items: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });
  it('history survives corrections back to original and inactivity, without exposing reasons', async () => {
    const f = await absence(),
      auth = await studentCookie(f.student.id);
    await post(`/admin/attendances/${f.attendanceId}/corrections`, {
      targetStatus: 'PRESENT',
      reason: 'Verificación final',
    }).expect(200);
    const history = (
      await get('/student/attendance-history?limit=1', auth).expect(200)
    ).body;
    expect(history.meta).toEqual({
      page: 1,
      limit: 1,
      total: 1,
      totalPages: 1,
    });
    expect(history.items[0]).toMatchObject({
      attendanceId: f.attendanceId,
      effectiveStatus: 'PRESENT',
      corrected: true,
      participationKind: 'REGULAR',
      recovery: null,
    });
    expect(Object.keys(history.items[0]).sort()).toEqual([
      'attendanceId',
      'classSession',
      'corrected',
      'effectiveStatus',
      'participationKind',
      'recovery',
    ]);
    await post(`/admin/students/${f.student.id}/deactivate`, {}).expect(200);
    expect(
      (
        await get(`/admin/students/${f.student.id}/attendance-history`).expect(
          200,
        )
      ).body.items[0].attendanceId,
    ).toBe(f.attendanceId);
    await get('/student/attendance-history', auth).expect(401);
    expect(
      (await get(`/admin/students/${f.student.id}/subscription-summary`)).body
        .subscription.usedClasses,
    ).toBe(1);
  });
  it('Admin upcoming includes effective Attendance and does not query participation per row', async () => {
    const f = await absence();
    const service = app.get(ClassParticipationService),
      spy = vi.spyOn(service, 'forSessions');
    const upcoming = await app
      .get(IntegrationReadsService)
      .upcoming(f.student.id, 20);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(upcoming.items[0]).toMatchObject({
      participationKind: 'REGULAR',
      attendance: { effectiveStatus: 'ABSENT', corrected: true },
      window: { status: 'OPEN' },
    });
    expect(
      (
        await get(
          `/admin/students/${f.student.id}/class-sessions/upcoming?limit=1`,
        ).expect(200)
      ).body.items[0].classSession.classSessionId,
    ).toBe(f.session.id);
  });
  it('role and ownership boundaries reject foreign filters and Admin reads', async () => {
    const a = await qrFixture(prisma),
      b = await absence(),
      auth = await studentCookie(a.student.id);
    await get(`/student/home-summary?studentId=${b.student.id}`, auth).expect(
      400,
    );
    await get(
      `/student/attendance-history?studentId=${b.student.id}`,
      auth,
    ).expect(400);
    expect(
      (await get('/student/attendance-history', auth).expect(200)).body.items,
    ).toEqual([]);
    for (const path of [
      `/admin/students/${b.student.id}/subscription-summary`,
      `/admin/students/${b.student.id}/attendance-history`,
      `/admin/students/${b.student.id}/class-sessions/upcoming`,
      `/admin/attendances/${b.attendanceId}/recovery-options`,
    ]) {
      await get(path, auth).expect(403);
      await get(path, '').expect(401);
    }
    await get('/student/home-summary').expect(403);
    await get(`/admin/students/${randomUUID()}/subscription-summary`).expect(
      404,
    );
  });
  it.each([
    'limit=101',
    'page=0',
    'dateFrom=2035-02-30',
    'dateFrom=2035-02-01&dateTo=2035-01-01',
    'dateFrom=2035-01-01&dateTo=2037-01-01',
    'extra=value',
  ])('rejects invalid history query %s', async (query) => {
    const f = await qrFixture(prisma);
    expect(
      (
        await get(
          `/admin/students/${f.student.id}/attendance-history?${query}`,
        ).expect(400)
      ).body.code,
    ).toBe('VALIDATION_FAILED');
  });
  it('today uses BusinessTime and rejects incompatible filters', async () => {
    const f = await qrFixture(prisma);
    clock.set(new Date('2035-01-11T01:00:00Z'));
    const response = (
      await get('/admin/class-sessions?today=true&limit=100').expect(200)
    ).body;
    expect(response.businessDate).toBe('2035-01-10');
    expect(
      response.items.some((r: { id: string }) => r.id === f.session.id),
    ).toBe(true);
    expect(
      response.items.every(
        (r: { occurrenceDate: string }) => r.occurrenceDate === '2035-01-10',
      ),
    ).toBe(true);
    await get('/admin/class-sessions?today=true&dateFrom=2035-01-10').expect(
      400,
    );
    await get('/admin/class-sessions?today=yes').expect(400);
  });
  it('real CORS preflight admits Idempotency-Key and rejects foreign origin', async () => {
    const path = '/api/v1/admin/subscriptions/' + randomUUID() + '/payments';
    const response = await request(app.getHttpServer())
      .options(path)
      .set('Origin', FRONTEND_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,idempotency-key')
      .expect(204);
    expect(response.headers['access-control-allow-headers']).toBe(
      'Content-Type,Idempotency-Key',
    );
    expect(response.headers['access-control-allow-origin']).toBe(
      FRONTEND_ORIGIN,
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    const denied = await request(app.getHttpServer())
      .options(path)
      .set('Origin', 'https://foreign.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'idempotency-key')
      .expect(403);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('infra/CSRF/payment codes are stable and legitimate payment replay succeeds', async () => {
    expect((await get('/student/home-summary', '').expect(401)).body.code).toBe(
      'UNAUTHORIZED',
    );
    expect((await get('/student/home-summary').expect(403)).body.code).toBe(
      'FORBIDDEN',
    );
    expect(
      (await get('/missing?secret=hidden').expect(404)).body,
    ).toMatchObject({ code: 'NOT_FOUND', path: '/api/v1/missing' });
    expect(
      (
        await request(app.getHttpServer())
          .post('/api/v1/auth/admin/login')
          .send({})
          .expect(403)
      ).body.code,
    ).toBe('CSRF_REJECTED');
    const f = await qrFixture(prisma),
      key = randomUUID(),
      path = '/api/v1/admin/subscriptions/' + f.subscription.id + '/payments';
    const pay = (amount: string) =>
      request(app.getHttpServer())
        .post(path)
        .set('Cookie', cookie)
        .set('Origin', FRONTEND_ORIGIN)
        .set('Idempotency-Key', key)
        .send({ amount, paidAt: '2026-01-01T00:00:00Z' });
    const first = await pay('10.00').expect(201),
      replay = await pay('10.00').expect(201);
    expect(replay.body.id).toBe(first.body.id);
    expect((await pay('11.00').expect(409)).body.code).toBe(
      'PAYMENT_IDEMPOTENCY_CONFLICT',
    );
    const over = await request(app.getHttpServer())
      .post(path)
      .set('Cookie', cookie)
      .set('Origin', FRONTEND_ORIGIN)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '1000.00', paidAt: '2026-01-01T00:00:00Z' })
      .expect(409);
    expect(over.body.code).toBe('PAYMENT_OVERPAYMENT');
  });
  it('inactive reservations still occupy capacity, unlike expected participants', async () => {
    const origin = await absence(),
      destination = await target();
    const occupant = await qrFixture(prisma, destination.scheduleId);
    await post(`/admin/students/${occupant.student.id}/deactivate`, {}).expect(
      200,
    );
    const participation = app.get(ClassParticipationService);
    await prisma.$transaction(async (tx) => {
      expect(
        (await participation.expected(tx, destination)).some(
          (p) => p.student.id === occupant.student.id,
        ),
      ).toBe(false);
      expect(
        (await participation.reservations(tx, destination)).has(
          occupant.student.id,
        ),
      ).toBe(true);
    });
    const options = (
      await get(
        `/admin/attendances/${origin.attendanceId}/recovery-options?dateFrom=2035-01-11&dateTo=2035-01-11&limit=100`,
      ).expect(200)
    ).body;
    expect(
      options.items.some(
        (r: { classSessionId: string }) => r.classSessionId === destination.id,
      ),
    ).toBe(false);
    expect(options.availabilityAsOf).toBe(QR_NOW.toISOString());
  });
  it('stale last-place options are informational: competing authorizations return CLASS_SESSION_FULL', async () => {
    const a = await absence(),
      b = await absence(),
      destination = await target();
    const options = (
      await get(
        `/admin/attendances/${a.attendanceId}/recovery-options?dateFrom=2035-01-11&dateTo=2035-01-11&limit=100`,
      ).expect(200)
    ).body;
    expect(
      options.items.find(
        (r: { classSessionId: string }) => r.classSessionId === destination.id,
      ),
    ).toMatchObject({ capacity: 1, occupied: 0, available: 1 });
    const both = await Promise.all(
      [a, b].map((f) =>
        post(`/admin/attendances/${f.attendanceId}/recovery`, {
          targetClassSessionId: destination.id,
        }),
      ),
    );
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(both.find((r) => r.status === 409)!.body.code).toBe(
      'CLASS_SESSION_FULL',
    );
    expect(
      await prisma.recovery.count({
        where: { recoverySessionId: destination.id, cancelledAt: null },
      }),
    ).toBe(1);
  });
  it('Home finds Recovery separately and history explains its original class without double consumption', async () => {
    const f = await absence(),
      destination = await target(),
      auth = await studentCookie(f.student.id);
    await post(`/admin/attendances/${f.attendanceId}/recovery`, {
      targetClassSessionId: destination.id,
    }).expect(200);
    expect(
      (await get('/student/home-summary', auth).expect(200)).body.nextRecovery,
    ).toMatchObject({
      participationKind: 'RECOVERY',
      classSession: { classSessionId: destination.id },
    });
    clock.set(destination.startAt);
    await post(
      `/admin/class-sessions/${destination.id}/students/${f.student.id}/attendance`,
      { reason: 'Asistencia recuperación' },
    ).expect(201);
    const history = (await get('/student/attendance-history', auth).expect(200))
      .body.items;
    expect(history[0]).toMatchObject({
      participationKind: 'RECOVERY',
      effectiveStatus: 'PRESENT',
      recovery: { originalClass: { classSessionId: f.session.id } },
    });
    expect(JSON.stringify(history)).not.toMatch(
      /creationReason|correctedByAdminId|reason|source/,
    );
    expect(
      (await get('/student/home-summary', auth)).body.subscription.usedClasses,
    ).toBe(1);
  });
  it('OpenAPI has precise essential contracts, scalar nullable types and errors', async () => {
    const document = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    for (const route of [
      '/student/home-summary',
      '/student/attendance-history',
      '/admin/students/{studentId}/subscription-summary',
      '/admin/students/{studentId}/class-sessions/upcoming',
      '/admin/students/{studentId}/attendance-history',
      '/admin/attendances/{attendanceId}/recovery-options',
    ])
      expect(
        document.paths['/api/v1' + route].get.responses['200'].content[
          'application/json'
        ].schema.$ref,
      ).toBeTruthy();
    const schemas = document.components.schemas;
    expect(schemas.ApiErrorDto.properties.code).toBeTruthy();
    expect(schemas.PaymentResponseDto.properties.amount.type).toBe('string');
    expect(schemas.PaymentResponseDto.properties.note).toMatchObject({
      type: 'string',
      nullable: true,
    });
    expect(
      schemas.SubscriptionResponseDto.properties.cancelledAt,
    ).toMatchObject({ type: 'string', format: 'date-time', nullable: true });
    expect(schemas.ReadClassDto.properties.occurrenceDate.format).toBe('date');
    expect(schemas.AttendanceHistoryItemDto.properties.corrected.type).toBe(
      'boolean',
    );
    expect(schemas.ContextSubscriptionDto.properties.status.enum).toContain(
      'ACTIVE',
    );
    expect(schemas.StudentHomeSummaryDto.properties.context.enum).toEqual([
      'CURRENT',
      'UPCOMING',
      'NONE',
    ]);
    expect(schemas.RecoveryOptionDto.properties.available.type).toBe('integer');
    for (const path of Object.values(document.paths) as Array<
      Record<
        string,
        {
          parameters?: Array<{ name: string; schema: { type?: string } }>;
          responses: Record<string, { content?: object }>;
        }
      >
    >)
      for (const operation of Object.values(path)) {
        for (const parameter of operation.parameters ?? [])
          if (['page', 'limit'].includes(parameter.name))
            expect(parameter.schema.type).toBe('integer');
        for (const [status, response] of Object.entries(operation.responses))
          if (Number(status) >= 400) expect(response.content).toBeTruthy();
      }
  });
});
