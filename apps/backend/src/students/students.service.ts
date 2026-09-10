import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SessionRole,
  Student,
  StudentAccessStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CLOCK, Clock } from '../time/clock';
import {
  ListStudentsQueryDto,
  StudentStatusFilter,
} from './dto/list-students-query.dto';

export const studentProjection = {
  id: true,
  fullName: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StudentSelect;

type StudentView = Pick<Student, keyof typeof studentProjection>;

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(fullName: string, actorId: string): Promise<StudentView> {
    return this.prisma.$transaction(async (tx) => {
      const now = this.clock.now();
      const student = await tx.student.create({
        data: { fullName, createdAt: now, updatedAt: now },
        select: studentProjection,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'STUDENT_CREATED',
          entity: 'Student',
          entityId: student.id,
          metadata: { fullName: student.fullName },
        },
      });
      return student;
    });
  }

  async list(query: ListStudentsQueryDto) {
    const where: Prisma.StudentWhereInput = {
      ...(query.status === StudentStatusFilter.ALL
        ? {}
        : { isActive: query.status === StudentStatusFilter.ACTIVE }),
      ...(query.search
        ? {
            fullName: {
              contains: query.search,
              mode: Prisma.QueryMode.insensitive,
            },
          }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;
    return this.prisma.$transaction(
      async (tx) => {
        const total = await tx.student.count({ where });
        const items = await tx.student.findMany({
          where,
          select: studentProjection,
          orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
          skip,
          take: query.limit,
        });
        return {
          items,
          meta: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.ceil(total / query.limit),
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async getById(id: string): Promise<StudentView> {
    const student = await this.prisma.student.findUnique({
      where: { id },
      select: studentProjection,
    });
    if (!student) throw new NotFoundException('Alumna no encontrada');
    return student;
  }

  async update(
    id: string,
    fullName: string,
    actorId: string,
  ): Promise<StudentView> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockStudent(tx, id);
      const before = await tx.student.findUnique({
        where: { id },
        select: studentProjection,
      });
      if (!before) throw new NotFoundException('Alumna no encontrada');
      if (before.fullName === fullName) return before;
      const student = await tx.student.update({
        where: { id },
        data: { fullName },
        select: studentProjection,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'STUDENT_UPDATED',
          entity: 'Student',
          entityId: id,
          metadata: {
            before: { fullName: before.fullName },
            after: { fullName: student.fullName },
          },
        },
      });
      return student;
    });
  }

  async deactivate(id: string, actorId: string): Promise<StudentView> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockStudent(tx, id);
      const current = await tx.student.findUnique({
        where: { id },
        select: studentProjection,
      });
      if (!current) throw new NotFoundException('Alumna no encontrada');
      if (!current.isActive) return current;

      const now = this.clock.now();
      const closedPeriod = await tx.studentActivePeriod.updateMany({
        where: {
          studentId: id,
          validFrom: { lte: now },
          validUntil: null,
        },
        data: { validUntil: now },
      });
      if (closedPeriod.count !== 1) {
        throw new ConflictException(
          'El historial operativo de la alumna es inconsistente',
        );
      }
      const student = await tx.student.update({
        where: { id },
        data: { isActive: false },
        select: studentProjection,
      });
      const pendingAccesses = await tx.studentAccess.updateMany({
        where: {
          studentId: id,
          status: StudentAccessStatus.PENDING,
          revokedAt: null,
          activatedAt: null,
        },
        data: { status: StudentAccessStatus.REVOKED, revokedAt: now },
      });
      const sessions = await tx.session.updateMany({
        where: { userId: id, role: SessionRole.STUDENT, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'STUDENT_DEACTIVATED',
          entity: 'Student',
          entityId: id,
          metadata: {
            effectiveAt: now.toISOString(),
            revokedPendingAccesses: pendingAccesses.count,
            revokedSessions: sessions.count,
          },
        },
      });
      return student;
    });
  }

  async reactivate(id: string, actorId: string): Promise<StudentView> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockStudent(tx, id);
      const current = await tx.student.findUnique({
        where: { id },
        select: studentProjection,
      });
      if (!current) throw new NotFoundException('Alumna no encontrada');
      if (current.isActive) return current;
      const now = this.clock.now();
      if (
        (await tx.studentActivePeriod.count({
          where: { studentId: id, validUntil: null },
        })) !== 0
      ) {
        throw new ConflictException(
          'El historial operativo de la alumna es inconsistente',
        );
      }
      await tx.studentActivePeriod.create({
        data: { studentId: id, validFrom: now },
      });
      const student = await tx.student.update({
        where: { id },
        data: { isActive: true },
        select: studentProjection,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'STUDENT_REACTIVATED',
          entity: 'Student',
          entityId: id,
          metadata: { effectiveAt: now.toISOString() },
        },
      });
      return student;
    });
  }

  private async lockStudent(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<void> {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Student" WHERE "id" = ${id} FOR UPDATE`,
    );
  }
}
