import { Inject, Injectable } from '@nestjs/common';

import { WebhookSecretStore } from '@queueforge/persistence';

import {
  WORKER_CONFIGURATION,
  type TenantScope,
  type WebhookSecretProviderPort,
  type WorkerConfiguration,
} from '../core/ports.js';

@Injectable()
export class DatabaseWebhookSecretProvider implements WebhookSecretProviderPort {
  public constructor(
    private readonly secrets: WebhookSecretStore,
    @Inject(WORKER_CONFIGURATION) private readonly configuration: WorkerConfiguration,
  ) {}

  public getSigningSecret(scope: TenantScope, endpointId: string, keyId: string): Promise<string> {
    return this.secrets.getSigningSecret(
      scope,
      endpointId,
      keyId,
      this.configuration.webhookMasterKeyBase64,
    );
  }
}
