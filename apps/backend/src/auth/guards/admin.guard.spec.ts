import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { AdminGuard } from './admin.guard';
import { StudentGuard } from './student.guard';
import { SessionService } from '../services/session.service';
import { SessionCookieService } from '../services/session-cookie.service';
import { PrismaService } from '../../prisma.service';
import { AuthenticatedUser } from '../types/auth.types';

describe('role guards', () => {
  const sessions = { validateSession: vi.fn() };
  const prisma = {
    admin: { findUnique: vi.fn() },
    student: { findUnique: vi.fn() },
  };
  const cookies = { read: vi.fn() };
  let adminGuard: AdminGuard;
  let studentGuard: StudentGuard;
  beforeEach(async () => {
    vi.clearAllMocks();
    cookies.read.mockReturnValue('token');
    sessions.validateSession.mockResolvedValue({
      id: 'session-1',
      userId: 'admin-1',
      role: 'ADMIN',
      expiresAt: new Date(),
    });
    prisma.admin.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.test',
    });
    prisma.student.findUnique.mockResolvedValue({
      id: 'student-1',
      fullName: 'Alumna de prueba',
      isActive: true,
    });
    const module = await Test.createTestingModule({
      providers: [
        AdminGuard,
        StudentGuard,
        { provide: SessionService, useValue: sessions },
        { provide: PrismaService, useValue: prisma },
        { provide: SessionCookieService, useValue: cookies },
      ],
    }).compile();
    adminGuard = module.get(AdminGuard);
    studentGuard = module.get(StudentGuard);
  });
  function context(
    request: { user?: AuthenticatedUser; body?: unknown } = {},
  ): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;
  }
  it('allows admin and derives identity from session rather than body', async () => {
    const req: { user?: AuthenticatedUser; body: unknown } = {
      body: { studentId: 'forged', role: 'STUDENT' },
    };
    expect(await adminGuard.canActivate(context(req))).toBe(true);
    expect(req.user?.id).toBe('admin-1');
    expect(req.user?.role).toBe('ADMIN');
  });
  it('rejects student attempting admin access', async () => {
    sessions.validateSession.mockResolvedValue({
      id: 'session-1',
      userId: 'student-1',
      role: 'STUDENT',
    });
    await expect(adminGuard.canActivate(context())).rejects.toThrow(
      ForbiddenException,
    );
  });
  it('rejects admin attempting student access', async () => {
    await expect(studentGuard.canActivate(context())).rejects.toThrow(
      ForbiddenException,
    );
  });
  it('rejects a missing cookie before querying a session', async () => {
    cookies.read.mockReturnValue(undefined);
    await expect(adminGuard.canActivate(context())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(sessions.validateSession).not.toHaveBeenCalled();
  });
  it('rejects a session whose owner no longer exists', async () => {
    prisma.admin.findUnique.mockResolvedValue(null);
    await expect(adminGuard.canActivate(context())).rejects.toThrow(
      UnauthorizedException,
    );
  });
  it('rejects an inactive student even when the session is otherwise valid', async () => {
    sessions.validateSession.mockResolvedValue({
      id: 'session-1',
      userId: 'student-1',
      role: 'STUDENT',
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.student.findUnique.mockResolvedValue(null);
    await expect(studentGuard.canActivate(context())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.student.findUnique).toHaveBeenCalledWith({
      where: { id: 'student-1', isActive: true },
      select: { id: true, fullName: true },
    });
  });
});
