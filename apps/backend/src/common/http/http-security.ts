import {
  BadRequestException,
  ForbiddenException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ErrorRequestHandler, RequestHandler } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import {
  AppSettings,
  Environment,
  RatePolicy,
} from '../../config/env.validation';
import { errorResponse } from '../filters/http-exception.filter';
import { apiFailure, ErrorCode } from './error-code';

export function securityHeaders(settings: AppSettings): RequestHandler {
  const production = settings.environment === Environment.Production;
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: production ? [] : null,
      },
    },
    strictTransportSecurity: production
      ? { maxAge: 31_536_000, includeSubDomains: false }
      : false,
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
  });
}

export function csrfProtection(settings: AppSettings): RequestHandler {
  const allowed = new Set([...settings.frontendOrigins, settings.apiOrigin]);
  return (request, _response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    const origin = request.get('origin');
    let source: string | undefined;
    if (origin !== undefined) source = origin;
    else {
      const referer = request.get('referer');
      if (referer) {
        try {
          const parsed = new URL(referer);
          if (
            !parsed.username &&
            !parsed.password &&
            ['http:', 'https:'].includes(parsed.protocol)
          )
            source = parsed.origin;
        } catch {
          /* Invalid or missing origins are rejected below. */
        }
      }
    }
    if (!source || !allowed.has(source))
      return next(
        new ForbiddenException(
          apiFailure(
            ErrorCode.CSRF_REJECTED,
            'Origen de la operación no permitido',
          ),
        ),
      );
    return next();
  };
}

export const jsonOnly: RequestHandler = (request, _response, next) => {
  const hasBody =
    Number(request.get('content-length') ?? '0') > 0 ||
    request.get('transfer-encoding') !== undefined;
  if (hasBody && !request.is('application/json'))
    return next(
      new UnsupportedMediaTypeException('Se requiere application/json'),
    );
  next();
};

// Normalize before Nest/Express can convert a parser error into a message that echoes input.
export const normalizeBodyError: ErrorRequestHandler = (
  error: unknown,
  _request,
  _response,
  next,
) => {
  if (
    error &&
    typeof error === 'object' &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  ) {
    return next(new BadRequestException('JSON inválido'));
  }
  return next(error);
};

function limiter(policy: RatePolicy, identifier: string): RequestHandler {
  return rateLimit({
    limit: policy.limit,
    windowMs: policy.windowMs,
    identifier,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // One store per category, shared by all requests in that category.
    handler: (request, response) => {
      response
        .status(429)
        .json(
          errorResponse(
            429,
            'Demasiadas solicitudes; intentá más tarde',
            request.path,
          ),
        );
    },
  });
}

export function rateLimiters(settings: AppSettings): RequestHandler[] {
  const policies = settings.rateLimits;
  const login = limiter(policies.login, 'login');
  const activation = limiter(policies.activation, 'activation');
  const access = limiter(policies.access, 'access');
  const sensitive: RequestHandler = (request, response, next) => {
    if (request.method !== 'POST') return next();
    const path = request.path.toLowerCase().replace(/\/$/, '');
    if (path === '/api/v1/auth/admin/login')
      return login(request, response, next);
    if (path === '/api/v1/auth/student/activate')
      return activation(request, response, next);
    if (/^\/api\/v1\/admin\/students\/[^/]+\/access$/.test(path))
      return access(request, response, next);
    return next();
  };
  return [limiter(policies.api, 'api'), sensitive];
}
