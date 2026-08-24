import { createParamDecorator, SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Request, Response } from 'express';

import type { TenantContext } from '@queueforge/contracts';

export const PUBLIC_ROUTE = 'queueforge.public-route';

export interface QueueForgeRequest extends Request {
  correlationId: string;
  requestId: string;
  tenantContext?: TenantContext;
  rawBody?: Buffer;
}

export interface GraphqlHttpContext {
  readonly req: QueueForgeRequest;
  readonly res: Response;
}

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);

export function requestFromContext(context: ExecutionContext): QueueForgeRequest {
  if (context.getType<string>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext<GraphqlHttpContext>().req;
  }
  return context.switchToHttp().getRequest<QueueForgeRequest>();
}

export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantContext => {
    const request = requestFromContext(context);
    if (request.tenantContext === undefined) {
      throw new Error('Authenticated tenant context is unavailable');
    }
    return request.tenantContext;
  },
);

export const RequestCorrelationId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => requestFromContext(context).correlationId,
);

export const RequestIdentifier = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => requestFromContext(context).requestId,
);
