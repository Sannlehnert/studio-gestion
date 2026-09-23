import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  defaultErrorCode,
  ErrorCode,
  publicErrorCode,
} from '../http/error-code';

export function errorResponse(
  statusCode: number,
  message: string | string[],
  path: string,
  code: ErrorCode = defaultErrorCode(statusCode),
) {
  const names: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    413: 'Payload Too Large',
    415: 'Unsupported Media Type',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    503: 'Service Unavailable',
  };
  return {
    statusCode,
    code,
    timestamp: new Date().toISOString(),
    path: path.split('?')[0],
    error: names[statusCode] ?? 'Error',
    message,
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Error interno del servidor';
    let code: ErrorCode | undefined;
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      statusCode = exception.getStatus();
      const body: unknown = exception.getResponse();
      if (body && typeof body === 'object' && 'code' in body)
        code = publicErrorCode(body.code);
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object' && 'message' in body) {
        const candidate: unknown = body.message;
        if (
          typeof candidate === 'string' ||
          (Array.isArray(candidate) &&
            candidate.every((value) => typeof value === 'string'))
        ) {
          message = candidate as string | string[];
        }
      }
    } else if (
      exception &&
      typeof exception === 'object' &&
      'type' in exception
    ) {
      if (exception.type === 'entity.too.large') {
        statusCode = 413;
        message = 'Payload demasiado grande';
      } else if (exception.type === 'entity.parse.failed') {
        statusCode = 400;
        message = 'JSON inválido';
      } else if (
        exception.type === 'encoding.unsupported' ||
        exception.type === 'charset.unsupported'
      ) {
        statusCode = 415;
        message = 'Codificación no soportada';
      }
    }
    // Nest's default 404 message can echo a query string containing a secret.
    if (statusCode === 404) message = 'Recurso no encontrado';
    if (statusCode >= 500) {
      this.logger.error({
        event: 'unexpected_error',
        type: exception instanceof Error ? exception.name : 'UnknownError',
      });
    }
    response
      .status(statusCode)
      .json(
        errorResponse(
          statusCode,
          message,
          request.originalUrl,
          statusCode === 404 ? ErrorCode.NOT_FOUND : code,
        ),
      );
  }
}
