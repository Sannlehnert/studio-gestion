import { Body, Controller, Get, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IsString } from 'class-validator';
import request from 'supertest';
import { validate } from '../../config/env.validation';
import { configureApp } from './configure-app';

class ProbeDto {
  @IsString() value!: string;
}
@Controller()
class ProbeController {
  @Get('probe') get() {
    return { ok: true };
  }
  @Post('probe') post(@Body() body: ProbeDto) {
    return body;
  }
  @Post('auth/admin/login') login(@Body() body: ProbeDto) {
    return body;
  }
  @Post('auth/student/activate') activate(@Body() body: ProbeDto) {
    return body;
  }
  @Post('admin/students/:id/access') access(@Body() body: ProbeDto) {
    return body;
  }
}
const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:55432/studio_gestion_test',
  RATE_API_LIMIT: 1000,
  RATE_LOGIN_LIMIT: 2,
  RATE_ACTIVATION_LIMIT: 3,
  RATE_ACCESS_LIMIT: 2,
};

describe('shared HTTP security stack', () => {
  let app: NestExpressApplication;
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        { provide: ConfigService, useValue: new ConfigService(validate(base)) },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    await configureApp(app);
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  it('allows an exact CORS origin with credentials', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers.vary).toContain('Origin');
  });
  it('allows same-origin backend requests and health clients without Origin', async () => {
    await request(app.getHttpServer()).get('/api/v1/probe').expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/probe')
      .set('Origin', 'http://localhost:3000')
      .expect(200);
  });
  it.each(['http://localhost:5173.evil.test', 'https://evil.test', 'null'])(
    'rejects foreign CORS origin %s',
    async (origin) => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/probe')
        .set('Origin', origin)
        .expect(403);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.body.stack).toBeUndefined();
    },
  );
  it('answers a legitimate preflight without requiring a session', async () => {
    const response = await request(app.getHttpServer())
      .options('/api/v1/probe')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,idempotency-key')
      .expect(204);
    expect(response.headers['access-control-allow-headers']).toBe(
      'Content-Type,Idempotency-Key',
    );
  });
  it('sets security headers on successful and rejected responses', async () => {
    for (const path of ['/api/v1/probe', '/missing']) {
      const response = await request(app.getHttpServer()).get(path);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['content-security-policy']).toContain(
        "frame-ancestors 'none'",
      );
      expect(response.headers['content-security-policy']).not.toContain(
        'unsafe-inline',
      );
      expect(response.headers['strict-transport-security']).toBeUndefined();
    }
  });
  it('serves Swagger assets and JSON with a local stylesheet exception', async () => {
    const page = await request(app.getHttpServer())
      .get('/api/docs/')
      .expect(200);
    expect(page.headers['content-security-policy']).toContain(
      "style-src 'self' 'unsafe-inline'",
    );
    expect(page.headers['content-security-policy']).toContain(
      "script-src 'self'",
    );
    await request(app.getHttpServer())
      .get('/api/docs/swagger-ui-init.js')
      .expect(200);
    await request(app.getHttpServer()).get('/api/docs-json').expect(200);
  });
  it.each([
    '/api/v1/probe',
    '/api/v1/auth/admin/login',
    '/api/v1/auth/student/activate',
  ])(
    'rejects CSRF with missing origin even before login at %s',
    async (path) => {
      await request(app.getHttpServer())
        .post(path)
        .send({ value: 'test' })
        .expect(403);
    },
  );
  it('uses Referer only when Origin is absent', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/probe')
      .set('Referer', 'http://localhost:5173/page')
      .send({ value: 'test' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/probe')
      .set('Origin', 'null')
      .set('Referer', 'http://localhost:5173/page')
      .send({ value: 'test' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/probe')
      .set('Referer', 'http://localhost:5173.evil.test/page')
      .send({ value: 'test' })
      .expect(403);
  });
  it('rejects a large payload with a consistent 413', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/probe')
      .set('Origin', 'http://localhost:5173')
      .send({ value: 'x'.repeat(17_000) })
      .expect(413);
    expect(response.body.error).toBe('Payload Too Large');
    expect(response.body.stack).toBeUndefined();
  });
  it.each(['{"secret": "sensitive-data"', 'sensitive-data'])(
    'rejects malformed JSON without echoing its contents',
    async (payload) => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/probe')
        .set('Origin', 'http://localhost:5173')
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(400);
      expect(JSON.stringify(response.body)).not.toContain('sensitive-data');
    },
  );
  it.each(['application/x-www-form-urlencoded', 'text/plain'])(
    'rejects unsupported body type %s',
    async (type) => {
      await request(app.getHttpServer())
        .post('/api/v1/probe')
        .set('Origin', 'http://localhost:5173')
        .set('Content-Type', type)
        .send('value=test')
        .expect(415);
    },
  );
  it('rejects mass assignment and omits query secrets from errors', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/probe')
      .set('Origin', 'http://localhost:5173')
      .send({ value: 'test', role: 'ADMIN' })
      .expect(400);
    const response = await request(app.getHttpServer())
      .get('/missing?token=private-secret')
      .expect(404);
    expect(JSON.stringify(response.body)).not.toContain('private-secret');
  });
  it.each([
    ['/api/v1/auth/admin/login', 2],
    ['/api/v1/auth/student/activate', 3],
    ['/api/v1/admin/students/student-1/access', 2],
  ])('applies the configured sensitive limit for %s', async (path, limit) => {
    for (let i = 0; i < Number(limit); i++) {
      await request(app.getHttpServer())
        .post(String(path))
        .set('Origin', 'http://localhost:5173')
        .send({ value: 'test' })
        .expect(201);
    }
    const response = await request(app.getHttpServer())
      .post(String(path))
      .set('Origin', 'http://localhost:5173')
      .send({ value: 'test' })
      .expect(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(response.body.statusCode).toBe(429);
    expect(response.body.code).toBe('RATE_LIMITED');
    await request(app.getHttpServer()).get('/api/v1/probe').expect(200);
  });
});
