import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SessionPayload } from '../types/auth.types';

export const CurrentSession = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): SessionPayload => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ session: SessionPayload }>();
    return request.session;
  },
);
