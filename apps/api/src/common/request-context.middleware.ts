import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';

import type { QueueForgeRequest } from './http-context.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function trustedCorrelationId(value: string | undefined): string {
  return value !== undefined && UUID_PATTERN.test(value) ? value : randomUUID();
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  public use(request: QueueForgeRequest, response: Response, next: NextFunction): void {
    request.requestId = randomUUID();
    request.correlationId = trustedCorrelationId(request.header('x-correlation-id'));
    response.setHeader('x-request-id', request.requestId);
    response.setHeader('x-correlation-id', request.correlationId);
    next();
  }
}
