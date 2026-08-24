import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import type { Response } from 'express';

import { ApplicationError } from '@queueforge/application';
import type { ErrorCode, JsonObject } from '@queueforge/contracts';
import { DomainError } from '@queueforge/domain';
import { PersistenceConflictError, PersistenceNotFoundError } from '@queueforge/persistence';

import type { GraphqlHttpContext, QueueForgeRequest } from './http-context.js';

interface MappedError {
  readonly code: ErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly message: string;
  readonly status: number;
}

const APPLICATION_STATUS: Readonly<Partial<Record<ErrorCode, number>>> = {
  AUTHENTICATION_REQUIRED: HttpStatus.UNAUTHORIZED,
  AUTHORIZATION_DENIED: HttpStatus.FORBIDDEN,
  CONFLICT: HttpStatus.CONFLICT,
  CSRF_VALIDATION_FAILED: HttpStatus.FORBIDDEN,
  DEPENDENCY_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  IDEMPOTENCY_KEY_REQUIRED: HttpStatus.BAD_REQUEST,
  IDEMPOTENCY_KEY_REUSE: HttpStatus.CONFLICT,
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  INVALID_STATE_TRANSITION: HttpStatus.CONFLICT,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  PAYLOAD_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  SELF_APPROVAL_FORBIDDEN: HttpStatus.CONFLICT,
  STALE_REVISION: HttpStatus.CONFLICT,
  TENANT_CONTEXT_REQUIRED: HttpStatus.BAD_REQUEST,
  TOKEN_REUSE_DETECTED: HttpStatus.UNAUTHORIZED,
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  WEBHOOK_REPLAY_DETECTED: HttpStatus.CONFLICT,
  WEBHOOK_SIGNATURE_INVALID: HttpStatus.UNAUTHORIZED,
  WEBHOOK_TARGET_BLOCKED: HttpStatus.BAD_REQUEST,
};

function mappedApplicationError(error: ApplicationError): MappedError {
  const status = APPLICATION_STATUS[error.code] ?? HttpStatus.BAD_REQUEST;
  return {
    code: error.code,
    message: status >= 500 ? 'The request could not be completed' : error.message,
    status,
    ...(status >= 500 || error.details === undefined ? {} : { details: error.details }),
  };
}

function mapException(exception: unknown): MappedError {
  if (exception instanceof ApplicationError) {
    return mappedApplicationError(exception);
  }
  if (exception instanceof DomainError) {
    const code: ErrorCode =
      exception.code === 'INVALID_STATE_TRANSITION'
        ? 'INVALID_STATE_TRANSITION'
        : 'VALIDATION_FAILED';
    return {
      code,
      details: exception.details,
      message: exception.message,
      status: APPLICATION_STATUS[code] ?? HttpStatus.BAD_REQUEST,
    };
  }
  if (exception instanceof PersistenceNotFoundError) {
    return { code: 'NOT_FOUND', message: exception.message, status: HttpStatus.NOT_FOUND };
  }
  if (exception instanceof PersistenceConflictError) {
    const knownCode = exception.code as ErrorCode;
    return {
      code: APPLICATION_STATUS[knownCode] === undefined ? 'CONFLICT' : knownCode,
      message: exception.message,
      status: APPLICATION_STATUS[knownCode] ?? HttpStatus.CONFLICT,
    };
  }
  if (exception instanceof Error && 'type' in exception && 'status' in exception) {
    const parserError = exception as Error & { readonly status?: unknown; readonly type?: unknown };
    if (parserError.type === 'entity.too.large' && parserError.status === 413) {
      return {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large',
        status: HttpStatus.PAYLOAD_TOO_LARGE,
      };
    }
    if (parserError.type === 'entity.parse.failed' && parserError.status === 400) {
      return {
        code: 'VALIDATION_FAILED',
        message: 'Request body contains malformed JSON',
        status: HttpStatus.BAD_REQUEST,
      };
    }
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status === Number(HttpStatus.TOO_MANY_REQUESTS)) {
      return { code: 'RATE_LIMITED', message: 'Request rate limit exceeded', status };
    }
    if (status === Number(HttpStatus.PAYLOAD_TOO_LARGE)) {
      return { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large', status };
    }
    const response = exception.getResponse();
    const responseObject =
      typeof response === 'object' ? (response as Readonly<Record<string, unknown>>) : undefined;
    const responseMessage = responseObject?.message;
    const message =
      typeof responseMessage === 'string'
        ? responseMessage
        : typeof response === 'string'
          ? response
          : exception.message;
    const responseDetails = responseObject?.details;
    return {
      code: status === Number(HttpStatus.NOT_FOUND) ? 'NOT_FOUND' : 'VALIDATION_FAILED',
      message: status >= 500 ? 'The request could not be completed' : message,
      status,
      ...(typeof responseDetails === 'object' && responseDetails !== null
        ? { details: responseDetails as Readonly<Record<string, unknown>> }
        : {}),
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
  };
}

function jsonDetails(
  details: Readonly<Record<string, unknown>> | undefined,
): JsonObject | undefined {
  if (details === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(details)) as JsonObject;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const mapped = mapException(exception);
    if (mapped.status >= 500) {
      this.logger.error(
        exception instanceof Error ? (exception.stack ?? exception.message) : 'Unknown exception',
      );
    }
    if (host.getType<string>() === 'graphql') {
      const context = host.getArgByIndex<GraphqlHttpContext>(2);
      throw new GraphQLError(mapped.message, {
        extensions: {
          code: mapped.code,
          correlationId: context.req.correlationId,
          requestId: context.req.requestId,
          ...(mapped.details === undefined ? {} : { details: jsonDetails(mapped.details) }),
        },
      });
    }
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<QueueForgeRequest>();
    response.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details === undefined ? {} : { details: jsonDetails(mapped.details) }),
      },
      requestId: request.requestId,
      correlationId: request.correlationId,
      timestamp: new Date().toISOString(),
    });
  }
}
