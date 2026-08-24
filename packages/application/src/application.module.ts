import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import type { RuntimeEnvironment } from '@queueforge/config';
import {
  AdminStore,
  ApiClientStore,
  ApprovalStore,
  IdentityStore,
  OperationsStore,
  ReadModelStore,
  RequestSubmissionStore,
  WebhookSecretStore,
  WebhookDeliveryStore,
  WorkflowStore,
} from '@queueforge/persistence';

import { AdminService } from './admin.service.js';
import { ApiClientService } from './api-client.service.js';
import { ApprovalService } from './approval.service.js';
import { AuthService } from './auth.service.js';
import { RUNTIME_ENVIRONMENT } from './configuration.js';
import { InboundWebhookService } from './inbound-webhook.service.js';
import { OperationsService } from './operations.service.js';
import { RequestService } from './request.service.js';
import { WebhookSecretService, WebhookService } from './webhook-secret.service.js';
import { WorkflowService } from './workflow.service.js';

const STORE_PROVIDERS = [
  AdminStore,
  ApiClientStore,
  ApprovalStore,
  IdentityStore,
  OperationsStore,
  ReadModelStore,
  RequestSubmissionStore,
  WebhookDeliveryStore,
  WebhookSecretStore,
  WorkflowStore,
] as const;

const APPLICATION_SERVICES = [
  AdminService,
  ApiClientService,
  ApprovalService,
  AuthService,
  InboundWebhookService,
  OperationsService,
  RequestService,
  WebhookSecretService,
  WebhookService,
  WorkflowService,
] as const;

@Module({})
export class ApplicationModule {
  public static forRoot(environment: RuntimeEnvironment): DynamicModule {
    return {
      module: ApplicationModule,
      imports: [JwtModule.register({})],
      providers: [
        ...STORE_PROVIDERS,
        ...APPLICATION_SERVICES,
        { provide: RUNTIME_ENVIRONMENT, useValue: environment },
      ],
      exports: [...APPLICATION_SERVICES, RUNTIME_ENVIRONMENT],
    };
  }
}
