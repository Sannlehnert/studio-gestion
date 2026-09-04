import { randomBytes, randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SessionRole, StudentAccessStatus } from '@prisma/client';
import { PrismaService } from '../src/prisma.service';
import { StudentStatusFilter } from '../src/students/dto/list-students-query.dto';
import { StudentsService } from '../src/students/students.service';
import { createTestApp } from './helpers';

describe('Students persistence with PostgreSQL (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let students: StudentsService;
  const actorId = 'integration-admin';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    students = app.get(StudentsService);
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('uses the PostgreSQL default for existing-style inserts and preserves the row', async () => {
    const id = randomUUID();
    const fullName = 'Default ' + randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "Student" ("id", "fullName", "createdAt", "updatedAt")
      VALUES (${id}, ${fullName}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    expect(
      await prisma.student.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({
      fullName,
      isActive: true,
    });
  });

  it('persists audit and paginates a case-insensitive search deterministically', async () => {
    const marker = randomUUID().slice(0, 8);
    const first = await students.create(`${marker} Ana`, actorId);
    const second = await students.create(`${marker} Beatriz`, actorId);
    await students.create(`${marker} Carla`, actorId);

    const page = await students.list({
      status: StudentStatusFilter.ALL,
      page: 1,
      limit: 2,
      search: marker.toUpperCase(),
    });
    expect(page.items).toHaveLength(2);
    expect(page.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(page.items.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'STUDENT_CREATED',
          entity: 'Student',
          entityId: { in: [first.id, second.id] },
        },
      }),
    ).toBe(2);
  });

  it('deactivates and reactivates atomically and idempotently without reviving credentials', async () => {
    const student = await students.create('Estado ' + randomUUID(), actorId);
    const access = await prisma.studentAccess.create({
      data: {
        studentId: student.id,
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const session = await prisma.session.create({
      data: {
        userId: student.id,
        role: SessionRole.STUDENT,
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect((await students.deactivate(student.id, actorId)).isActive).toBe(
      false,
    );
    await students.deactivate(student.id, actorId);
    expect(
      await prisma.studentAccess.findUniqueOrThrow({
        where: { id: access.id },
      }),
    ).toMatchObject({
      status: StudentAccessStatus.REVOKED,
      revokedAt: expect.any(Date),
    });
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: session.id } }))
        .revokedAt,
    ).toEqual(expect.any(Date));
    expect(
      await prisma.auditLog.count({
        where: { action: 'STUDENT_DEACTIVATED', entityId: student.id },
      }),
    ).toBe(1);

    expect((await students.reactivate(student.id, actorId)).isActive).toBe(
      true,
    );
    await students.reactivate(student.id, actorId);
    expect(
      (
        await prisma.studentAccess.findUniqueOrThrow({
          where: { id: access.id },
        })
      ).status,
    ).toBe(StudentAccessStatus.REVOKED);
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: session.id } }))
        .revokedAt,
    ).not.toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { action: 'STUDENT_REACTIVATED', entityId: student.id },
      }),
    ).toBe(1);
  });

  it('audits only actual name changes and returns 404 without partial writes', async () => {
    const student = await students.create(
      'Nombre original ' + randomUUID(),
      actorId,
    );
    await students.update(student.id, student.fullName, actorId);
    expect(
      await prisma.auditLog.count({
        where: { action: 'STUDENT_UPDATED', entityId: student.id },
      }),
    ).toBe(0);
    const updated = await students.update(
      student.id,
      'Nombre actualizado',
      actorId,
    );
    expect(updated.fullName).toBe('Nombre actualizado');
    expect(
      await prisma.auditLog.count({
        where: { action: 'STUDENT_UPDATED', entityId: student.id },
      }),
    ).toBe(1);
    await expect(
      students.deactivate(randomUUID(), actorId),
    ).rejects.toMatchObject({ status: 404 });
  });
});
