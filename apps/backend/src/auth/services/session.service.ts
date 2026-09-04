import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TokenService } from './token.service';
import { SessionRole } from '@prisma/client';
import type { Prisma, Session } from '@prisma/client';

@Injectable()
export class SessionService {
  constructor(
    private prisma: PrismaService,
    private tokenService: TokenService,
  ) {}

  async createSession(
    userId: string,
    role: SessionRole,
    ip?: string,
    userAgent?: string,
    ttlMs?: number,
    client: Pick<Prisma.TransactionClient, 'session'> = this.prisma,
  ): Promise<{ token: string; session: Session }> {
    const token = this.tokenService.generateToken();
    const tokenHash = this.tokenService.hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (ttlMs ?? 86400000));

    const session = await client.session.create({
      data: {
        userId,
        role,
        tokenHash,
        expiresAt,
        ip,
        userAgent,
      },
    });

    return { token, session };
  }

  async validateSession(token: string): Promise<Session> {
    const tokenHash = this.tokenService.hashToken(token);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
    });

    if (!session) {
      throw new UnauthorizedException('Sesión no encontrada');
    }

    if (session.revokedAt) {
      throw new UnauthorizedException('Sesión revocada');
    }

    const now = new Date();
    if (session.expiresAt <= now) {
      throw new UnauthorizedException('Sesión expirada');
    }

    const touched = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
      data: { lastSeenAt: now },
    });

    // A database lock wait must not extend the session's absolute lifetime.
    if (touched.count !== 1 || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Sesión inválida');
    }

    return session;
  }

  async revokeSession(token: string): Promise<void> {
    const tokenHash = this.tokenService.hashToken(token);
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({ where: { tokenHash } });
      if (!session) return;
      const changed = await tx.session.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (changed.count === 1) {
        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            action: 'SESSION_REVOKED',
            entity: 'Session',
            entityId: session.id,
            metadata: { role: session.role },
          },
        });
      }
    });
  }
}
