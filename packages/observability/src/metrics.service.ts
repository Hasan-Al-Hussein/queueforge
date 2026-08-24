import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  public readonly httpRequests = new Counter({
    name: 'queueforge_http_requests_total',
    help: 'HTTP requests handled by the API',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [this.registry],
  });

  public readonly httpDuration = new Histogram({
    name: 'queueforge_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  public readonly dependencyReady = new Gauge({
    name: 'queueforge_dependency_ready',
    help: 'Dependency readiness (1 ready, 0 unavailable)',
    labelNames: ['dependency'] as const,
    registers: [this.registry],
  });

  public constructor() {
    this.registry.setDefaultLabels({ service: 'queueforge-api' });
    collectDefaultMetrics({ register: this.registry, prefix: 'queueforge_' });
  }

  public get contentType(): string {
    return this.registry.contentType;
  }

  public render(): Promise<string> {
    return this.registry.metrics();
  }
}
