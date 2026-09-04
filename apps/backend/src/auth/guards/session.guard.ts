import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { SessionService } from '../services/session.service';
import { AuthenticatedUser, SessionPayload } from '../types/auth.types';
import { PrismaService } from '../../prisma.service';
import { SessionCookieService } from '../services/session-cookie.service';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    protected sessionService: SessionService,
    protected prisma: PrismaService,
    protected cookies: SessionCookieService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<
        Request & { user?: AuthenticatedUser; session?: SessionPayload }
      >();
    const token = this.cookies.read(request);

    if (!token) {
      throw new UnauthorizedException('No autenticado');
    }

    const session = await this.sessionService.validateSession(token);

    let email: string | undefined;
    let fullName: string | undefined;

    if (session.role === 'ADMIN') {
      const admin = await this.prisma.admin.findUnique({
        where: { id: session.userId },
        select: { id: true, email: true },
      });
      if (!admin) {
        throw new UnauthorizedException('Usuario no encontrado');
      }
      email = admin.email;
    } else if (session.role === 'STUDENT') {
      const student = await this.prisma.student.findUnique({
        where: { id: session.userId, isActive: true },
        select: { id: true, fullName: true },
      });
      if (!student) {
        throw new UnauthorizedException('Usuario no disponible');
      }
      fullName = student.fullName;
    }

    const user: AuthenticatedUser = {
      id: session.userId,
      role: session.role,
      email,
      fullName,
    };

    request.user = user;
    request.session = {
      sessionId: session.id,
      userId: session.userId,
      role: session.role,
      expiresAt: session.expiresAt,
    };

    return true;
  }
}
