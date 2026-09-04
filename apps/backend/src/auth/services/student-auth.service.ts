import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SessionRole, StudentAccessStatus } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { getSettings } from '../../config/env.validation';
import { TokenService } from './token.service';
import { SessionService } from './session.service';

@Injectable()
export class StudentAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly config: ConfigService,
  ) {}

  async createAccess(studentId: string, actorId: string, expiresInDays = 7) {
    const plainToken = this.tokenService.generateToken();
    const tokenHash = this.tokenService.hashToken(plainToken);
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);
    const access = await this.prisma.$transaction(async (tx) => {
      const student = await this.lockStudent(tx, studentId);
      if (!student) throw new NotFoundException('Alumna no encontrada');
      if (!student.isActive) throw new ConflictException('Alumna desactivada');
      const created = await tx.studentAccess.create({
        data: {
          studentId,
          tokenHash,
          expiresAt,
          status: StudentAccessStatus.PENDING,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'STUDENT_ACCESS_CREATED',
          entity: 'StudentAccess',
          entityId: created.id,
          metadata: { studentId, expiresAt: expiresAt.toISOString() },
        },
      });
      return created;
    });
    const activationUrl = new URL(
      '/activate',
      getSettings(this.config).frontendOrigin,
    );
    // Fragments are not sent to web servers or in Referer headers.
    activationUrl.hash = 'token=' + encodeURIComponent(plainToken);
    return {
      accessId: access.id,
      activationUrl: activationUrl.toString(),
      expiresAt,
    };
  }

  async activate(plainToken: string, ip?: string, userAgent?: string) {
    const tokenHash = this.tokenService.hashToken(plainToken);
    return this.prisma.$transaction(async (tx) => {
      const access = await tx.studentAccess.findUnique({
        where: { tokenHash },
      });
      const now = new Date();
      if (
        !access ||
        access.status !== StudentAccessStatus.PENDING ||
        access.revokedAt ||
        access.activatedAt ||
        access.expiresAt <= now
      ) {
        throw new UnauthorizedException('Acceso inválido');
      }
      const student = await this.lockStudent(tx, access.studentId);
      if (!student?.isActive)
        throw new UnauthorizedException('Acceso inválido');
      // PostgreSQL rechecks this predicate after waiting for a concurrent row update.
      const claimed = await tx.studentAccess.updateMany({
        where: {
          id: access.id,
          status: StudentAccessStatus.PENDING,
          revokedAt: null,
          activatedAt: null,
          expiresAt: { gt: now },
        },
        data: { status: StudentAccessStatus.ACTIVATED, activatedAt: now },
      });
      // Recheck the clock after any database wait; throwing rolls back the claim.
      if (claimed.count !== 1 || access.expiresAt <= new Date())
        throw new UnauthorizedException('Acceso inválido');
      const { token, session } = await this.sessionService.createSession(
        access.studentId,
        SessionRole.STUDENT,
        ip,
        userAgent,
        getSettings(this.config).studentSessionTtlMs,
        tx,
      );
      await tx.auditLog.create({
        data: {
          actorId: access.studentId,
          action: 'STUDENT_ACCESS_ACTIVATED',
          entity: 'StudentAccess',
          entityId: access.id,
          metadata: { sessionId: session.id },
        },
      });
      return {
        student: { id: student.id, fullName: student.fullName },
        sessionToken: token,
        expiresAt: session.expiresAt,
      };
    });
  }

  async revokeAccess(
    studentId: string,
    accessId: string,
    actorId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const changed = await tx.studentAccess.updateMany({
        where: {
          id: accessId,
          studentId,
          status: StudentAccessStatus.PENDING,
          revokedAt: null,
          activatedAt: null,
        },
        data: { status: StudentAccessStatus.REVOKED, revokedAt: now },
      });
      if (changed.count === 1) {
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'STUDENT_ACCESS_REVOKED',
            entity: 'StudentAccess',
            entityId: accessId,
            metadata: { studentId },
          },
        });
        return;
      }
      const access = await tx.studentAccess.findUnique({
        where: { id: accessId },
      });
      if (!access || access.studentId !== studentId)
        throw new NotFoundException('Acceso no encontrado');
      if (access.status === StudentAccessStatus.REVOKED) return;
      // Revoking an activation link must not pretend to revoke an established session.
      throw new ConflictException('El acceso ya fue activado');
    });
  }

  private async lockStudent(tx: Prisma.TransactionClient, studentId: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string; fullName: string; isActive: boolean }>
    >(Prisma.sql`
      SELECT "id", "fullName", "isActive"
      FROM "Student"
      WHERE "id" = ${studentId}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }
}
