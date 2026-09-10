import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';
import { PrismaService } from '../prisma.service';
import { Clock } from '../time/clock';
import { StudentStatusFilter } from './dto/list-students-query.dto';
import { StudentsService } from './students.service';

describe('StudentsService', () => {
  const now = new Date('2026-09-03T12:00:00Z');
  const student = {
    id: 'student-1',
    fullName: 'Martina López',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  const tx = {
    $queryRaw: vi.fn(),
    student: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    studentAccess: { updateMany: vi.fn() },
    session: { updateMany: vi.fn() },
    studentActivePeriod: {
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn((operation: (client: typeof tx) => unknown) =>
      operation(tx),
    ),
  };
  let service: StudentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ id: student.id }]);
    tx.student.create.mockResolvedValue(student);
    tx.student.findUnique.mockResolvedValue(student);
    tx.student.update.mockResolvedValue(student);
    tx.student.count.mockResolvedValue(1);
    tx.student.findMany.mockResolvedValue([student]);
    tx.studentAccess.updateMany.mockResolvedValue({ count: 2 });
    tx.session.updateMany.mockResolvedValue({ count: 1 });
    tx.auditLog.create.mockResolvedValue({});
    tx.studentActivePeriod.count.mockResolvedValue(0);
    tx.studentActivePeriod.create.mockResolvedValue({});
    tx.studentActivePeriod.updateMany.mockResolvedValue({ count: 1 });
    service = new StudentsService(
      prisma as unknown as PrismaService,
      {
        now: () => now,
      } as Clock,
    );
  });

  it('creates an active student and audit atomically with explicit fields', async () => {
    expect(await service.create(student.fullName, 'admin-1')).toEqual(student);
    expect(tx.student.create).toHaveBeenCalledWith({
      data: { fullName: student.fullName, createdAt: now, updatedAt: now },
      select: expect.objectContaining({
        id: true,
        fullName: true,
        isActive: true,
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin-1',
        action: 'STUDENT_CREATED',
        entityId: student.id,
      }),
    });
  });

  it('lists with bounded offset, case-insensitive search and a consistent snapshot', async () => {
    const result = await service.list({
      status: StudentStatusFilter.INACTIVE,
      page: 2,
      limit: 10,
      search: 'martina',
    });
    expect(tx.student.count).toHaveBeenCalledWith({
      where: {
        isActive: false,
        fullName: { contains: 'martina', mode: Prisma.QueryMode.insensitive },
      },
    });
    expect(tx.student.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(result.meta).toEqual({
      page: 2,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
  });

  it('returns 404 for a missing student', async () => {
    tx.student.findUnique.mockResolvedValue(null);
    await expect(service.getById('missing')).rejects.toThrow(NotFoundException);
    await expect(
      service.update('missing', 'Nombre', 'admin-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('serializes an update and audits only an actual name change', async () => {
    const changed = { ...student, fullName: 'Martina Sol López' };
    tx.student.update.mockResolvedValue(changed);
    expect(
      await service.update(student.id, changed.fullName, 'admin-1'),
    ).toEqual(changed);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.student.update).toHaveBeenCalledWith({
      where: { id: student.id },
      data: { fullName: changed.fullName },
      select: expect.any(Object),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'STUDENT_UPDATED',
        metadata: {
          before: { fullName: student.fullName },
          after: { fullName: changed.fullName },
        },
      }),
    });

    vi.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ id: student.id }]);
    tx.student.findUnique.mockResolvedValue(student);
    expect(
      await service.update(student.id, student.fullName, 'admin-1'),
    ).toEqual(student);
    expect(tx.student.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('deactivates atomically, revoking pending accesses and student sessions', async () => {
    const inactive = { ...student, isActive: false };
    tx.student.update.mockResolvedValue(inactive);
    expect(await service.deactivate(student.id, 'admin-1')).toEqual(inactive);
    expect(tx.studentActivePeriod.updateMany).toHaveBeenCalledWith({
      where: {
        studentId: student.id,
        validFrom: { lte: now },
        validUntil: null,
      },
      data: { validUntil: now },
    });
    expect(tx.studentAccess.updateMany).toHaveBeenCalledWith({
      where: {
        studentId: student.id,
        status: 'PENDING',
        revokedAt: null,
        activatedAt: null,
      },
      data: { status: 'REVOKED', revokedAt: expect.any(Date) },
    });
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { userId: student.id, role: 'STUDENT', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'STUDENT_DEACTIVATED',
        metadata: {
          effectiveAt: now.toISOString(),
          revokedPendingAccesses: 2,
          revokedSessions: 1,
        },
      }),
    });
  });

  it('makes repeated deactivation idempotent without changing related records or audit', async () => {
    const inactive = { ...student, isActive: false };
    tx.student.findUnique.mockResolvedValue(inactive);
    expect(await service.deactivate(student.id, 'admin-1')).toEqual(inactive);
    expect(tx.student.update).not.toHaveBeenCalled();
    expect(tx.studentActivePeriod.updateMany).not.toHaveBeenCalled();
    expect(tx.studentAccess.updateMany).not.toHaveBeenCalled();
    expect(tx.session.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('reactivates only the entity and remains idempotent', async () => {
    const inactive = { ...student, isActive: false };
    tx.student.findUnique.mockResolvedValue(inactive);
    tx.student.update.mockResolvedValue(student);
    expect(await service.reactivate(student.id, 'admin-1')).toEqual(student);
    expect(tx.studentActivePeriod.count).toHaveBeenCalledWith({
      where: { studentId: student.id, validUntil: null },
    });
    expect(tx.studentActivePeriod.create).toHaveBeenCalledWith({
      data: { studentId: student.id, validFrom: now },
    });
    expect(tx.student.update).toHaveBeenCalledWith({
      where: { id: student.id },
      data: { isActive: true },
      select: expect.any(Object),
    });
    expect(tx.studentAccess.updateMany).not.toHaveBeenCalled();
    expect(tx.session.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'STUDENT_REACTIVATED',
        metadata: { effectiveAt: now.toISOString() },
      }),
    });

    vi.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ id: student.id }]);
    tx.student.findUnique.mockResolvedValue(student);
    expect(await service.reactivate(student.id, 'admin-1')).toEqual(student);
    expect(tx.student.update).not.toHaveBeenCalled();
    expect(tx.studentActivePeriod.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
