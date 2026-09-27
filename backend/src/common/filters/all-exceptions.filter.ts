import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

/**
 * Centralised error handling. Guarantees a single response shape and makes sure
 * internal details (SQL, stack traces, secrets) never reach the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let code = 'INTERNAL_ERROR';
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const obj = body as Record<string, unknown>;
        message = (obj.message as string | string[]) ?? exception.message;
        code = (obj.code as string) ?? this.defaultCode(status);
        details = obj.details;
      }
      code = code === 'INTERNAL_ERROR' ? this.defaultCode(status) : code;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      ({ status, message, code } = this.mapPrismaError(exception));
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid query payload';
      code = 'DB_VALIDATION_ERROR';
    }

    const logPayload = {
      path: request.url,
      method: request.method,
      status,
      code,
      ip: request.ip,
      requestId: (request as Request & { requestId?: string }).requestId,
    };

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} ${code}: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${status} ${code}`);
    }

    response.status(status).json({
      success: false,
      error: {
        code,
        message: this.rateLimitMessage(status, message),
        details,
        requestId: logPayload.requestId,
      },
    });
  }

  private defaultCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE',
      429: 'TOO_MANY_REQUESTS',
    };
    return map[status] ?? 'INTERNAL_ERROR';
  }

  /**
   * Rewrites the generic 429 body.
   *
   * The throttler answers with "ThrottlerException: Too Many Requests", which
   * tells a customer nothing actionable — it reads like the site is broken, and
   * the Arabic front-end then shows a vague "try again shortly" with no idea
   * whether to wait five seconds or five minutes. The window is a fixed 60
   * seconds, so say so.
   */
  private rateLimitMessage(status: number, message: string | string[]): string | string[] {
    if (status !== HttpStatus.TOO_MANY_REQUESTS) return message;
    // Nest lets a handler attach an array of validation messages, so the
    // string case is narrowed rather than assumed.
    if (typeof message !== 'string') return message;
    if (message.includes('15 minutes')) return message; // the per-account lockout
    return 'You have sent too many requests in the last minute. Please wait 60 seconds and try again.';
  }

  private mapPrismaError(e: Prisma.PrismaClientKnownRequestError): {
    status: number;
    message: string;
    code: string;
  } {
    switch (e.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          message: 'A record with this unique value already exists',
          code: 'DUPLICATE_RECORD',
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Related record does not exist',
          code: 'FK_VIOLATION',
        };
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, message: 'Record not found', code: 'NOT_FOUND' };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Database error',
          code: 'DB_ERROR',
        };
    }
  }
}
