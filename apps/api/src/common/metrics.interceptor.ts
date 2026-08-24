import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { finalize } from 'rxjs';

import { MetricsService } from '@queueforge/observability';

import { requestFromContext } from './http-context.js';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  public constructor(private readonly metrics: MetricsService) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = process.hrtime.bigint();
    const request = requestFromContext(context);
    const response =
      context.getType<string>() === 'graphql'
        ? undefined
        : context.switchToHttp().getResponse<{ statusCode: number }>();
    return next.handle().pipe(
      finalize(() => {
        const seconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
        const method = context.getType<string>() === 'graphql' ? 'GRAPHQL' : request.method;
        const routeValue = (request as unknown as { route?: { path?: unknown } }).route?.path;
        const route =
          context.getType<string>() === 'graphql'
            ? context.getHandler().name
            : typeof routeValue === 'string'
              ? routeValue
              : 'unmatched';
        const statusCode = String(response?.statusCode ?? 200);
        this.metrics.httpRequests.inc({ method, route, status_code: statusCode });
        this.metrics.httpDuration.observe({ method, route, status_code: statusCode }, seconds);
      }),
    );
  }
}
