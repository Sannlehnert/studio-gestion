import { ValidationPipe, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { json, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { getSettings } from '../../config/env.validation';
import {
  AllExceptionsFilter,
  errorResponse,
} from '../filters/http-exception.filter';
import {
  csrfProtection,
  jsonOnly,
  normalizeBodyError,
  rateLimiters,
  securityHeaders,
} from './http-security';
import { ApiErrorDto } from './error-response.dto';

// Call with bodyParser:false. Tests and the executable use this same HTTP stack.
export async function configureApp(app: NestExpressApplication): Promise<void> {
  const settings = getSettings(app.get(ConfigService));
  app.set('trust proxy', settings.trustProxy);
  app.use(securityHeaders(settings));
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(...rateLimiters(settings));
  app.enableCors({
    origin: (origin, callback) => {
      const allowed =
        !origin ||
        [...settings.frontendOrigins, settings.apiOrigin].includes(origin);
      callback(
        allowed ? null : new ForbiddenException('Origin no permitido'),
        allowed,
      );
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    exposedHeaders: ['Retry-After', 'RateLimit', 'RateLimit-Policy'],
    maxAge: 600,
  });
  app.use(csrfProtection(settings));
  app.use(jsonOnly);
  app.use(
    json({ limit: settings.bodyLimitBytes, strict: true, inflate: false }),
  );
  app.use(normalizeBodyError);
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  if (settings.swaggerEnabled) {
    // Swagger uses inline style attributes. Only its development UI receives this exception.
    app.use(
      '/api/docs',
      helmet.contentSecurityPolicy({
        directives: {
          defaultSrc: ["'none'"],
          scriptSrc: ["'self'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: null,
        },
      }),
    );
    const config = new DocumentBuilder()
      .setTitle('Studio Gestión API')
      .setDescription('API para gestión de clases')
      .setVersion('0.1.0')
      .addCookieAuth(
        settings.cookieName,
        { type: 'apiKey', in: 'cookie' },
        'session',
      )
      .addGlobalResponse(
        ...[400, 401, 403, 404, 409, 413, 415, 429, 500].map((status) => ({
          status,
          type: ApiErrorDto,
        })),
      )
      .addTag('auth')
      .addTag('health')
      .addTag('admin')
      .addTag('student')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: false },
    });
  }
  await app.init();
  // Nest 12 scopes its 404 route to the API prefix. Cover all other paths too.
  app.use((request: Request, response: Response) => {
    response
      .status(404)
      .json(errorResponse(404, 'Recurso no encontrado', request.originalUrl));
  });
}
