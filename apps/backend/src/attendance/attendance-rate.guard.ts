import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { MemoryStore, rateLimit } from 'express-rate-limit';
import { AuthenticatedUser } from '../auth/types/auth.types';
import { getSettings } from '../config/env.validation';

// Applied after AdminGuard/StudentGuard. No cookie or client-supplied identity is a key.
@Injectable()
export class AttendanceRateGuard implements CanActivate, OnModuleDestroy {
  private readonly stores = [new MemoryStore(), new MemoryStore()];
  private readonly attendance;
  private readonly qr;

  constructor(config: ConfigService) {
    const settings = getSettings(config);
    const create = (
      category: 'attendance' | 'qrChallenge',
      store: MemoryStore,
    ) =>
      rateLimit({
        ...settings.rateLimits[category],
        store,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        identifier: category,
        keyGenerator: (request) => {
          const user = (request as Request & { user: AuthenticatedUser }).user;
          return category === 'attendance'
            ? user.id
            : user.id + ':' + request.params.classSessionId;
        },
        handler: (_request, _response, next) =>
          next(
            new HttpException('Demasiadas solicitudes; intentá más tarde', 429),
          ),
      });
    this.attendance = create('attendance', this.stores[0]);
    this.qr = create('qrChallenge', this.stores[1]);
  }

  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user) throw new UnauthorizedException('No autenticado');
    const response = context.switchToHttp().getResponse<Response>();
    const middleware =
      request.user.role === 'ADMIN' ? this.qr : this.attendance;
    await new Promise<void>((resolve, reject) =>
      middleware(request, response, (error?: unknown) =>
        error ? reject(error) : resolve(),
      ),
    );
    return true;
  }

  onModuleDestroy() {
    for (const store of this.stores) store.shutdown();
  }
}
