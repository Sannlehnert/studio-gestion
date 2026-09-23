import { apiFailure, ErrorCode } from '../../common/http/error-code';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionRole } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { getSettings } from '../../config/env.validation';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly sessionService: SessionService,
    private readonly config: ConfigService,
  ) {}

  async login(
    email: string,
    password: string,
    ip?: string,
    userAgent?: string,
  ) {
    const admin = await this.prisma.admin.findUnique({ where: { email } });
    if (!admin) {
      await this.passwordService.verifyDummy(password);
      throw new UnauthorizedException(
        apiFailure(ErrorCode.INVALID_CREDENTIALS, 'Credenciales inválidas'),
      );
    }
    if (!(await this.passwordService.verify(admin.passwordHash, password))) {
      throw new UnauthorizedException(
        apiFailure(ErrorCode.INVALID_CREDENTIALS, 'Credenciales inválidas'),
      );
    }
    const { token, session } = await this.prisma.$transaction(async (tx) => {
      const created = await this.sessionService.createSession(
        admin.id,
        SessionRole.ADMIN,
        ip,
        userAgent,
        getSettings(this.config).adminSessionTtlMs,
        tx,
      );
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'ADMIN_LOGIN',
          entity: 'Session',
          entityId: created.session.id,
        },
      });
      return created;
    });
    return {
      admin: { id: admin.id, email: admin.email },
      sessionToken: token,
      expiresAt: session.expiresAt,
    };
  }

  async validateSession(token: string) {
    const session = await this.sessionService.validateSession(token);
    if (session.role !== SessionRole.ADMIN)
      throw new UnauthorizedException(
        apiFailure(ErrorCode.SESSION_INVALID, 'Sesión inválida'),
      );
    return session;
  }

  async logout(token: string) {
    await this.sessionService.revokeSession(token);
  }
}
