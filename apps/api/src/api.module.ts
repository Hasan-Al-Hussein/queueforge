import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { ApplicationModule } from '@queueforge/application';
import { loadRuntimeEnvironment } from '@queueforge/config';
import { ObservabilityModule } from '@queueforge/observability';
import { PersistenceModule } from '@queueforge/persistence';

import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { API_GUARD_CLASSES } from './common/api-guards.js';
import { HttpMetricsInterceptor } from './common/metrics.interceptor.js';
import { RequestContextMiddleware } from './common/request-context.middleware.js';
import { ApprovalController } from './controllers/approval.controller.js';
import { ApiClientController } from './controllers/api-client.controller.js';
import { AuthController, SessionController } from './controllers/auth.controller.js';
import {
  AuditController,
  DashboardController,
  NotificationController,
  OperationsController,
} from './controllers/operations.controller.js';
import { RequestController } from './controllers/request.controller.js';
import { TeamController, TenantAdminController } from './controllers/team.controller.js';
import { InboundWebhookController, WebhookController } from './controllers/webhook.controller.js';
import { WorkflowController } from './controllers/workflow.controller.js';
import { DependencyProbeService } from './health/dependency-probe.service.js';
import { HealthController, MetricsController } from './health/health.controller.js';
import { GraphqlApiModule } from './graphql/graphql-api.module.js';
import { QueueForgeResolver } from './graphql/queueforge.resolver.js';

export const runtimeEnvironment = loadRuntimeEnvironment();

@Module({
  imports: [
    PersistenceModule.forRoot(
      runtimeEnvironment.DATABASE_URL,
      runtimeEnvironment.NODE_ENV === 'development' && runtimeEnvironment.LOG_LEVEL === 'debug',
    ),
    ApplicationModule.forRoot(runtimeEnvironment),
    ObservabilityModule.forRoot({
      serviceName: 'queueforge-api',
      environment: runtimeEnvironment.NODE_ENV,
      logLevel: runtimeEnvironment.LOG_LEVEL,
    }),
    GraphqlApiModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
  ],
  controllers: [
    ApprovalController,
    ApiClientController,
    AuditController,
    AuthController,
    DashboardController,
    HealthController,
    InboundWebhookController,
    MetricsController,
    NotificationController,
    OperationsController,
    RequestController,
    SessionController,
    TeamController,
    TenantAdminController,
    WebhookController,
    WorkflowController,
  ],
  providers: [
    DependencyProbeService,
    QueueForgeResolver,
    RequestContextMiddleware,
    ...API_GUARD_CLASSES.map((guard) => ({ provide: APP_GUARD, useClass: guard })),
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class ApiModule {}
