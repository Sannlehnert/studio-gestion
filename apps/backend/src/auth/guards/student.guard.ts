import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { SessionGuard } from './session.guard';
import { SessionService } from '../services/session.service';
import { PrismaService } from '../../prisma.service';
import { AuthenticatedUser } from '../types/auth.types';
import { SessionCookieService } from '../services/session-cookie.service';

@Injectable()
export class StudentGuard extends SessionGuard implements CanActivate {
  constructor(
    sessionService: SessionService,
    prisma: PrismaService,
    cookies: SessionCookieService,
  ) {
    super(sessionService, prisma, cookies);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isAuthenticated = await super.canActivate(context);
    if (!isAuthenticated) return false;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    if (request.user?.role !== 'STUDENT') {
      throw new ForbiddenException('Se requieren permisos de estudiante');
    }
    return true;
  }
}
