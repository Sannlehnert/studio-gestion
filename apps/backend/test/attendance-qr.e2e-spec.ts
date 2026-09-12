import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
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
import { QrClock, qrFixture, QR_NOW } from './qr-fixture';

describe('QR HTTP authorization, replay and shared Wi-Fi (e2e)', () => {
  const clock = new QrClock();
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let adminCookie: string;
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
    const credentials = await createAdmin(app, prisma);
    adminCookie = sessionCookie(
      await loginAdmin(app, credentials.admin.email, credentials.password),
    );
  });
  beforeEach(() => clock.set(QR_NOW));
  afterAll(async () => {
    if (app) await app.close();
  });
  const qrPath = (id: string) =>
    `/api/v1/admin/class-sessions/${id}/qr-challenge`;
  const attendancePath = (id: string) =>
    `/api/v1/student/class-sessions/${id}/attendance`;
  const post = (path: string, cookie: string, body: object = {}) =>
    request(app.getHttpServer())
      .post(path)
      .set('Cookie', cookie)
      .set('Origin', FRONTEND_ORIGIN)
      .send(body);
  async function activate(id: string) {
    const access = await post(
      `/api/v1/admin/students/${id}/access`,
      adminCookie,
      { expiresInDays: 1 },
    ).expect(201);
    return sessionCookie(
      await request(app.getHttpServer())
        .post('/api/v1/auth/student/activate')
        .set('Origin', FRONTEND_ORIGIN)
        .send({ token: activationToken(access) })
        .expect(200),
    );
  }

  it('requires Admin issuance, Student authentication, CSRF and strict DTOs', async () => {
    const f = await qrFixture(prisma),
      cookie = await activate(f.student.id);
    await request(app.getHttpServer())
      .post(qrPath(f.session.id))
      .set('Origin', FRONTEND_ORIGIN)
      .send({})
      .expect(401);
    await post(qrPath(f.session.id), cookie).expect(403);
    await request(app.getHttpServer())
      .post(qrPath(f.session.id))
      .set('Cookie', adminCookie)
      .send({})
      .expect(403);
    await post(qrPath(f.session.id), adminCookie, {
      expiresAt: '2099-01-01',
    }).expect(400);
    const issued = await post(qrPath(f.session.id), adminCookie).expect(201);
    expect(issued.headers['cache-control']).toBe('no-store');
    expect(Object.keys(issued.body).sort()).toEqual([
      'challenge',
      'classSessionId',
      'expiresAt',
    ]);
    expect(issued.body.challenge).toMatch(/^sgq_[A-Za-z0-9_-]{43}$/);
    await request(app.getHttpServer())
      .post(attendancePath(f.session.id))
      .set('Origin', FRONTEND_ORIGIN)
      .send({ challenge: issued.body.challenge })
      .expect(401);
    await post(attendancePath(f.session.id), adminCookie, {
      challenge: issued.body.challenge,
    }).expect(403);
    await request(app.getHttpServer())
      .post(attendancePath(f.session.id))
      .set('Cookie', cookie)
      .send({ challenge: issued.body.challenge })
      .expect(403);
    for (const body of [
      {},
      { challenge: '' },
      { challenge: null },
      { challenge: 'bad' },
      { challenge: issued.body.challenge, studentId: f.student.id },
      { challenge: issued.body.challenge, status: 'PRESENT' },
      { challenge: issued.body.challenge, recordedAt: QR_NOW.toISOString() },
    ]) {
      await post(attendancePath(f.session.id), cookie, body).expect(400);
    }
    const enormous = 'sgq_' + 'S'.repeat(100000);
    const rejected = await post(attendancePath(f.session.id), cookie, {
      challenge: enormous,
    }).expect(413);
    expect(JSON.stringify(rejected.body)).not.toContain(enormous);
    expect(
      await prisma.attendance.count({
        where: { classSessionId: f.session.id },
      }),
    ).toBe(0);
  });

  it('rejects cross-class tokens and foreign Students without exposing secrets', async () => {
    const f = await qrFixture(prisma),
      foreign = await qrFixture(prisma);
    const cookie = await activate(f.student.id),
      foreignCookie = await activate(foreign.student.id);
    const own = await post(qrPath(f.session.id), adminCookie).expect(201);
    const other = await post(qrPath(foreign.session.id), adminCookie).expect(
      201,
    );
    const logs = vi.spyOn(Logger.prototype, 'error');
    try {
      const errors = [
        await post(attendancePath(f.session.id), cookie, {
          challenge: other.body.challenge,
        }).expect(409),
        await post(attendancePath(f.session.id), cookie, {
          challenge: 'sgq_' + 'A'.repeat(43),
        }).expect(409),
        await post(attendancePath(f.session.id), foreignCookie, {
          challenge: own.body.challenge,
        }).expect(404),
      ];
      for (const error of errors) {
        expect(JSON.stringify(error.body)).not.toContain(own.body.challenge);
        expect(JSON.stringify(error.body)).not.toContain(other.body.challenge);
        expect(error.body).not.toHaveProperty('stack');
      }
      expect(JSON.stringify(logs.mock.calls)).not.toContain(own.body.challenge);
      expect(JSON.stringify(logs.mock.calls)).not.toContain(
        other.body.challenge,
      );
    } finally {
      logs.mockRestore();
    }
  });

  it('accepts valid replay but rejects expired replay with controlled clock', async () => {
    const f = await qrFixture(prisma),
      cookie = await activate(f.student.id);
    const a = await post(qrPath(f.session.id), adminCookie).expect(201);
    const body = { challenge: a.body.challenge };
    const first = await post(attendancePath(f.session.id), cookie, body).expect(
      200,
    );
    const replay = await post(
      attendancePath(f.session.id),
      cookie,
      body,
    ).expect(200);
    expect(replay.body.attendance.id).toBe(first.body.attendance.id);
    expect(replay.body.classSummary).toMatchObject({
      usedClasses: 1,
      remainingClasses: 3,
    });
    clock.set(new Date(a.body.expiresAt));
    await post(attendancePath(f.session.id), cookie, body).expect(409);
    expect(
      await prisma.attendance.count({
        where: { classSessionId: f.session.id },
      }),
    ).toBe(1);
    clock.set(QR_NOW);
    const unmarked = await qrFixture(prisma),
      unmarkedCookie = await activate(unmarked.student.id);
    const expired = await post(qrPath(unmarked.session.id), adminCookie).expect(
      201,
    );
    clock.set(new Date(expired.body.expiresAt));
    await post(attendancePath(unmarked.session.id), unmarkedCookie, {
      challenge: expired.body.challenge,
    }).expect(409);
    expect(
      await prisma.attendance.count({
        where: { classSessionId: unmarked.session.id },
      }),
    ).toBe(0);
  });

  it('supports immediate reloads and rejects the oldest challenge after two rotations', async () => {
    const f = await qrFixture(prisma),
      cookie = await activate(f.student.id);
    const a = await post(qrPath(f.session.id), adminCookie).expect(201);
    const b = await post(qrPath(f.session.id), adminCookie).expect(201);
    await post(attendancePath(f.session.id), cookie, {
      challenge: a.body.challenge,
    }).expect(200);
    await post(qrPath(f.session.id), adminCookie).expect(201);
    await post(attendancePath(f.session.id), cookie, {
      challenge: a.body.challenge,
    }).expect(409);
    await post(attendancePath(f.session.id), cookie, {
      challenge: b.body.challenge,
    }).expect(200);
  });

  it('revokes cancelled QR and enforces the window even with an unexpired token', async () => {
    const f = await qrFixture(prisma),
      cookie = await activate(f.student.id);
    const a = await post(qrPath(f.session.id), adminCookie).expect(201);
    clock.set(new Date('2035-01-10T11:00:00Z'));
    await post(attendancePath(f.session.id), cookie, {
      challenge: a.body.challenge,
    }).expect(409);
    clock.set(QR_NOW);
    await post(
      `/api/v1/admin/class-sessions/${f.session.id}/cancel`,
      adminCookie,
      { reason: 'Clase cancelada QR' },
    ).expect(200);
    await post(attendancePath(f.session.id), cookie, {
      challenge: a.body.challenge,
    }).expect(409);
    await post(qrPath(f.session.id), adminCookie).expect(409);
  });

  it('limits by authenticated Student across sessions, independently of shared IP', async () => {
    const f = await qrFixture(prisma),
      other = await qrFixture(prisma, f.session.scheduleId);
    const cookie = await activate(f.student.id),
      secondSession = await activate(f.student.id),
      otherCookie = await activate(other.student.id);
    const a = await post(qrPath(f.session.id), adminCookie).expect(201);
    for (let i = 0; i < 20; i++)
      await post(attendancePath(f.session.id), cookie, {
        challenge: a.body.challenge,
      }).expect(200);
    const limited = await post(attendancePath(f.session.id), secondSession, {
      challenge: a.body.challenge,
    }).expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await post(attendancePath(f.session.id), otherCookie, {
      challenge: a.body.challenge,
    }).expect(200);
    expect(
      await prisma.attendance.count({
        where: { classSessionId: f.session.id },
      }),
    ).toBe(2);
  });

  it('limits Admin issuance per identity and class while allowing another class', async () => {
    const f = await qrFixture(prisma),
      other = await qrFixture(prisma);
    for (let i = 0; i < 20; i++)
      await post(qrPath(f.session.id), adminCookie).expect(201);
    const limited = await post(qrPath(f.session.id), adminCookie).expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await post(qrPath(other.session.id), adminCookie).expect(201);
    expect(
      await prisma.attendanceChallenge.count({
        where: { classSessionId: f.session.id, revokedAt: null },
      }),
    ).toBe(2);
    expect(
      await prisma.attendanceChallenge.count({
        where: { classSessionId: f.session.id },
      }),
    ).toBe(3);
  });

  it('documents only opaque challenge contracts without examples or internal hashes', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const schemas = response.body.components.schemas;
    expect(schemas.MarkPresentDto.required).toContain('challenge');
    expect(schemas.MarkPresentDto.properties.challenge).toMatchObject({
      type: 'string',
      writeOnly: true,
      maxLength: 47,
    });
    expect(
      schemas.AttendanceChallengeResponseDto.properties.challenge,
    ).not.toHaveProperty('example');
    expect(
      JSON.stringify(schemas.AttendanceChallengeResponseDto),
    ).not.toContain('tokenHash');
    expect(
      response.body.paths[
        '/api/v1/admin/class-sessions/{classSessionId}/qr-challenge'
      ].post.security,
    ).toEqual([{ session: [] }]);
  });
});
