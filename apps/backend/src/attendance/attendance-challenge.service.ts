import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { TokenService } from '../auth/services/token.service';
import { getSettings } from '../config/env.validation';
import { PrismaService } from '../prisma.service';
import { CLOCK, Clock } from '../time/clock';
import {
  assertAttendanceOpen,
  assertChallengeFormat,
  assertChallengeValid,
} from './attendance-challenge';

@Injectable()
export class AttendanceChallengeService {
  private readonly settings;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    config: ConfigService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.settings = getSettings(config);
  }

  async issue(classSessionId: string, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "ClassSession" WHERE "id" = ${classSessionId} FOR UPDATE`,
      );
      const session = await tx.classSession.findUnique({
        where: { id: classSessionId },
      });
      if (!session) throw new NotFoundException('Clase no encontrada');
      const now = this.clock.now();
      const window = assertAttendanceOpen(
        session,
        now,
        this.settings.attendanceOpenBeforeMinutes,
        this.settings.attendanceCloseAfterMinutes,
      );
      // Challenges are ephemeral. Audit events survive this bounded, class-local cleanup.
      await tx.attendanceChallenge.deleteMany({
        where: {
          classSessionId,
          OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }],
        },
      });
      const previous = await tx.attendanceChallenge.findMany({
        where: { classSessionId, revokedAt: null },
        orderBy: { generation: 'desc' },
        select: { id: true },
      });
      if (previous.length > 1) {
        await tx.attendanceChallenge.updateMany({
          where: { id: { in: previous.slice(1).map((row) => row.id) } },
          data: { revokedAt: now },
        });
      }
      // Read time after database waits; the original expiry is never extended.
      const createdAt = this.clock.now();
      assertAttendanceOpen(
        session,
        createdAt,
        this.settings.attendanceOpenBeforeMinutes,
        this.settings.attendanceCloseAfterMinutes,
      );
      const expiresAt = new Date(
        Math.min(
          createdAt.getTime() + this.settings.qrChallengeTtlSeconds * 1000,
          window.closesAt.getTime(),
        ),
      );
      const challenge = 'sgq_' + this.tokens.generateToken();
      const record = await tx.attendanceChallenge.create({
        data: {
          classSessionId,
          tokenHash: this.tokens.hashToken(challenge),
          createdAt,
          expiresAt,
          createdByAdminId: adminId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: adminId,
          action: 'ATTENDANCE_CHALLENGE_ISSUED',
          entity: 'AttendanceChallenge',
          entityId: record.id,
          metadata: {
            classSessionId,
            expiresAt: expiresAt.toISOString(),
            rotated: previous.length > 0,
            revokedCount: Math.max(0, previous.length - 1),
          },
        },
      });
      assertChallengeValid(record, classSessionId, this.clock.now());
      return { challenge, classSessionId, expiresAt };
    });
  }

  // The caller holds the ClassSession lock throughout validation and PRESENT.
  async find(tx: Prisma.TransactionClient, value: string) {
    assertChallengeFormat(value);
    return tx.attendanceChallenge.findUnique({
      where: { tokenHash: this.tokens.hashToken(value) },
    });
  }
}
