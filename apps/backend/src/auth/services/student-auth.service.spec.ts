import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { StudentAccessStatus } from '@prisma/client';
import { vi } from 'vitest';
import { StudentAuthService } from './student-auth.service';
import { PrismaService } from '../../prisma.service';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { validate } from '../../config/env.validation';

describe('StudentAuthService', () => {
  const now = new Date('2026-09-02T15:00:00Z');
  const student = {
    id: 'student-1',
    fullName: 'Alumna de prueba',
    isActive: true,
  };
  const access = {
    id: 'access-1',
    studentId: student.id,
    tokenHash: 'hash_token',
    status: StudentAccessStatus.PENDING,
    expiresAt: new Date(now.getTime() + 60_000),
    revokedAt: null,
    activatedAt: null,
    createdAt: now,
    student,
  };
  const tx = {
    $queryRaw: vi.fn(),
    student: { findUnique: vi.fn() },
    studentAccess: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const tokens = {
    generateToken: vi.fn(() => 'token'),
    hashToken: vi.fn(() => 'hash_token'),
  };
  const sessions = { createSession: vi.fn() };
  let service: StudentAuthService;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    tx.student.findUnique.mockResolvedValue(student);
    tx.$queryRaw.mockResolvedValue([student]);
    tx.studentAccess.create.mockResolvedValue(access);
    tx.studentAccess.findUnique.mockResolvedValue(access);
    tx.studentAccess.updateMany.mockResolvedValue({ count: 1 });
    tx.auditLog.create.mockResolvedValue({});
    sessions.createSession.mockResolvedValue({
      token: 'session-token',
      session: { id: 'session-1', expiresAt: access.expiresAt },
    });
    const module = await Test.createTestingModule({
      providers: [
        StudentAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: tokens },
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
    service = module.get(StudentAuthService);
  });
  afterEach(() => vi.useRealTimers());

  it('creates an auditable access with hash-only persistence and fragment URL', async () => {
    const result = await service.createAccess(student.id, 'admin-1', 7);
    expect(result.accessId).toBe(access.id);
    expect(new URL(result.activationUrl).search).toBe('');
    expect(new URL(result.activationUrl).hash).toBe('#token=token');
    expect(tx.studentAccess.create).toHaveBeenCalledWith({
      data: {
        studentId: student.id,
        tokenHash: 'hash_token',
        expiresAt: new Date(now.getTime() + 7 * 86_400_000),
        status: 'PENDING',
      },
    });
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain(
      'hash_token',
    );
  });
  it('returns 404 for a missing student without creating an access', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(service.createAccess('missing', 'admin-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(tx.studentAccess.create).not.toHaveBeenCalled();
  });
  it('rejects access generation for an inactive student', async () => {
    tx.$queryRaw.mockResolvedValue([{ ...student, isActive: false }]);
    await expect(service.createAccess(student.id, 'admin-1')).rejects.toThrow(
      ConflictException,
    );
    expect(tx.studentAccess.create).not.toHaveBeenCalled();
  });
  it('claims the token before creating a session on the same transaction', async () => {
    const result = await service.activate('token');
    expect(result.student).toEqual({
      id: student.id,
      fullName: student.fullName,
    });
    expect(result.sessionToken).toBe('session-token');
    expect(tx.studentAccess.updateMany).toHaveBeenCalledWith({
      where: {
        id: access.id,
        status: 'PENDING',
        activatedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { status: 'ACTIVATED', activatedAt: now },
    });
    expect(sessions.createSession).toHaveBeenCalledWith(
      student.id,
      'STUDENT',
      undefined,
      undefined,
      2_592_000_000,
      tx,
    );
    expect(
      tx.studentAccess.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(sessions.createSession.mock.invocationCallOrder[0]);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    { ...access, status: StudentAccessStatus.ACTIVATED },
    { ...access, status: StudentAccessStatus.REVOKED },
    { ...access, revokedAt: now },
    { ...access, activatedAt: now },
    { ...access, expiresAt: now },
    { ...access, expiresAt: new Date(now.getTime() - 1) },
  ])('rejects missing, consumed, revoked or expired access', async (stored) => {
    tx.studentAccess.findUnique.mockResolvedValue(stored);
    await expect(service.activate('token')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(sessions.createSession).not.toHaveBeenCalled();
  });
  it('does not create a session if a concurrent operation wins the claim', async () => {
    tx.studentAccess.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.activate('token')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  it('rejects activation if the student became inactive after issuance', async () => {
    tx.$queryRaw.mockResolvedValue([{ ...student, isActive: false }]);
    await expect(service.activate('token')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(tx.studentAccess.updateMany).not.toHaveBeenCalled();
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  it('rejects access that expires while awaiting the claim', async () => {
    tx.studentAccess.updateMany.mockImplementationOnce(async () => {
      vi.setSystemTime(access.expiresAt);
      return { count: 1 };
    });
    await expect(service.activate('token')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(sessions.createSession).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('propagates session creation failure so the transaction can roll back', async () => {
    sessions.createSession.mockRejectedValue(new Error('simulated failure'));
    await expect(service.activate('token')).rejects.toThrow(
      'simulated failure',
    );
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('revokes only the requested student access and audits once', async () => {
    await service.revokeAccess(student.id, access.id, 'admin-1');
    expect(tx.studentAccess.updateMany).toHaveBeenCalledWith({
      where: {
        id: access.id,
        studentId: student.id,
        status: 'PENDING',
        revokedAt: null,
        activatedAt: null,
      },
      data: { status: 'REVOKED', revokedAt: now },
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('treats repeated revocation as success without another audit event', async () => {
    tx.studentAccess.updateMany.mockResolvedValue({ count: 0 });
    tx.studentAccess.findUnique.mockResolvedValue({
      ...access,
      status: 'REVOKED',
      revokedAt: now,
    });
    await expect(
      service.revokeAccess(student.id, access.id, 'admin-1'),
    ).resolves.toBeUndefined();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('does not expose access belonging to another student', async () => {
    tx.studentAccess.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.revokeAccess('other-student', access.id, 'admin-1'),
    ).rejects.toThrow(NotFoundException);
  });
  it('does not pretend that revoking a consumed link revokes its session', async () => {
    tx.studentAccess.updateMany.mockResolvedValue({ count: 0 });
    tx.studentAccess.findUnique.mockResolvedValue({
      ...access,
      status: 'ACTIVATED',
    });
    await expect(
      service.revokeAccess(student.id, access.id, 'admin-1'),
    ).rejects.toThrow(ConflictException);
  });
});
