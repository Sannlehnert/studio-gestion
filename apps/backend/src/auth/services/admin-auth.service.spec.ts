import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { vi } from 'vitest';
import { AdminAuthService } from './admin-auth.service';
import { PrismaService } from '../../prisma.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { validate } from '../../config/env.validation';

describe('AdminAuthService', () => {
  const admin = {
    id: 'admin-1',
    email: 'admin@example.test',
    passwordHash: 'hashed_password',
  };
  const tx = { auditLog: { create: vi.fn() } };
  const prisma = {
    admin: { findUnique: vi.fn() },
    $transaction: (fn: (client: typeof tx) => unknown) => fn(tx),
  };
  const passwords = { verify: vi.fn(), verifyDummy: vi.fn() };
  const sessions = {
    createSession: vi.fn(),
    validateSession: vi.fn(),
    revokeSession: vi.fn(),
  };
  let service: AdminAuthService;
  beforeEach(async () => {
    vi.clearAllMocks();
    prisma.admin.findUnique.mockResolvedValue(admin);
    passwords.verify.mockResolvedValue(true);
    passwords.verifyDummy.mockResolvedValue(undefined);
    sessions.createSession.mockResolvedValue({
      token: 'session-token',
      session: { id: 'session-1', expiresAt: new Date() },
    });
    const module = await Test.createTestingModule({
      providers: [
        AdminAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordService, useValue: passwords },
        { provide: SessionService, useValue: sessions },
        {
          provide: ConfigService,
          useValue: new ConfigService(
            validate({
              NODE_ENV: 'test',
              DATABASE_URL: 'postgresql://test:test@localhost/studio_test',
            }),
          ),
        },
      ],
    }).compile();
    service = module.get(AdminAuthService);
  });
  it('creates and audits a session in the same transaction without exposing the hash', async () => {
    const result = await service.login(admin.email, 'password');
    expect(result.admin).toEqual({ id: admin.id, email: admin.email });
    expect(sessions.createSession).toHaveBeenCalledWith(
      admin.id,
      'ADMIN',
      undefined,
      undefined,
      86_400_000,
      tx,
    );
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('performs a dummy hash verification for an unknown email', async () => {
    prisma.admin.findUnique.mockResolvedValue(null);
    await expect(
      service.login('unknown@example.test', 'password'),
    ).rejects.toThrow('Credenciales inválidas');
    expect(passwords.verifyDummy).toHaveBeenCalledWith('password');
    expect(sessions.createSession).not.toHaveBeenCalled();
  });
  it('rejects wrong passwords with the same public error', async () => {
    passwords.verify.mockResolvedValue(false);
    await expect(service.login(admin.email, 'wrong')).rejects.toThrow(
      'Credenciales inválidas',
    );
    expect(sessions.createSession).not.toHaveBeenCalled();
  });
  it('accepts an admin session', async () => {
    sessions.validateSession.mockResolvedValue({ role: 'ADMIN' });
    expect(await service.validateSession('token')).toEqual({ role: 'ADMIN' });
  });
  it('rejects a student session', async () => {
    sessions.validateSession.mockResolvedValue({ role: 'STUDENT' });
    await expect(service.validateSession('token')).rejects.toThrow(
      UnauthorizedException,
    );
  });
  it('delegates logout to persisted session revocation', async () => {
    await service.logout('token');
    expect(sessions.revokeSession).toHaveBeenCalledWith('token');
  });
});
