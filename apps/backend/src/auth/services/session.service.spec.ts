import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { Session, SessionRole } from '@prisma/client';
import { vi } from 'vitest';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { PrismaService } from '../../prisma.service';

describe('SessionService', () => {
  const now = new Date('2026-09-02T15:00:00.000Z');
  const stored: Session = {
    id: 'session-1',
    userId: 'user-1',
    role: SessionRole.ADMIN,
    tokenHash: 'hash_token',
    expiresAt: new Date(now.getTime() + 60_000),
    revokedAt: null,
    createdAt: now,
    lastSeenAt: now,
    ip: null,
    userAgent: null,
  };
  const tx = {
    session: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    ...tx,
    $transaction: (fn: (client: typeof tx) => unknown) => fn(tx),
  };
  const tokens = {
    generateToken: vi.fn(() => 'token'),
    hashToken: vi.fn((token: string) => 'hash_' + token),
  };
  let service: SessionService;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    prisma.session.create.mockResolvedValue(stored);
    prisma.session.findUnique.mockResolvedValue(stored);
    prisma.session.updateMany.mockResolvedValue({ count: 1 });
    const module = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: tokens },
      ],
    }).compile();
    service = module.get(SessionService);
  });
  afterEach(() => vi.useRealTimers());

  it('stores only the token hash and calculates the absolute expiration', async () => {
    const result = await service.createSession(
      'user-1',
      SessionRole.ADMIN,
      undefined,
      undefined,
      60_000,
    );
    expect(prisma.session.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        role: SessionRole.ADMIN,
        tokenHash: 'hash_token',
        expiresAt: stored.expiresAt,
        ip: undefined,
        userAgent: undefined,
      },
    });
    expect(result.token).toBe('token');
  });

  it('looks up the unique token hash and touches only an active session', async () => {
    expect(await service.validateSession('token')).toEqual(stored);
    expect(prisma.session.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: 'hash_token' },
    });
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { id: stored.id, revokedAt: null, expiresAt: { gt: now } },
      data: { lastSeenAt: now },
    });
  });

  it('rejects an unknown token', async () => {
    prisma.session.findUnique.mockResolvedValue(null);
    await expect(service.validateSession('unknown')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
  });

  it.each([0, -1])(
    'rejects expiration at or before now (%i ms)',
    async (offset) => {
      prisma.session.findUnique.mockResolvedValue({
        ...stored,
        expiresAt: new Date(now.getTime() + offset),
      });
      await expect(service.validateSession('token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.session.updateMany).not.toHaveBeenCalled();
    },
  );

  it('rejects a revoked session', async () => {
    prisma.session.findUnique.mockResolvedValue({ ...stored, revokedAt: now });
    await expect(service.validateSession('token')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
  });

  it('rejects revocation between lookup and the conditional update', async () => {
    prisma.session.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.validateSession('token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a session that expires while awaiting the database update', async () => {
    prisma.session.updateMany.mockImplementationOnce(async () => {
      vi.setSystemTime(stored.expiresAt);
      return { count: 1 };
    });
    await expect(service.validateSession('token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('validates either stored role without converting one role into the other', async () => {
    prisma.session.findUnique.mockResolvedValue({
      ...stored,
      role: SessionRole.STUDENT,
    });
    expect((await service.validateSession('token')).role).toBe(
      SessionRole.STUDENT,
    );
  });

  it('revokes idempotently without replacing the first revocation date', async () => {
    await service.revokeSession('token');
    prisma.session.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.revokeSession('token')).resolves.toBeUndefined();
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: now },
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
