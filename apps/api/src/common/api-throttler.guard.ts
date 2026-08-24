import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';

import type { GraphqlHttpContext } from './http-context.js';

@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected override getRequestResponse(context: ExecutionContext): {
    req: Record<string, unknown>;
    res: Record<string, unknown>;
  } {
    if (context.getType<string>() === 'graphql') {
      const graphql = GqlExecutionContext.create(context).getContext<GraphqlHttpContext>();
      return {
        req: graphql.req as unknown as Record<string, unknown>,
        res: graphql.res as unknown as Record<string, unknown>,
      };
    }
    return super.getRequestResponse(context);
  }
}
