import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { RuntimeEnvironment } from '@queueforge/config';
import type { JsonObject, TenantContext } from '@queueforge/contracts';
import { createIdempotencyFingerprint, sha256Hex } from '@queueforge/domain';
import {
  WebhookDeliveryStore,
  WebhookSecretStore,
  type TenantScope,
} from '@queueforge/persistence';

import { requireAnyRole } from './authorization.js';
import { RUNTIME_ENVIRONMENT } from './configuration.js';

@Injectable()
export class WebhookSecretService {
  public constructor(
    private readonly secrets: WebhookSecretStore,
    @Inject(RUNTIME_ENVIRONMENT) private readonly environment: RuntimeEnvironment,
  ) {}

  public getSigningSecret(
    scope: TenantScope,
    endpointId: string,
    keyId: string,
  ): ReturnType<WebhookSecretStore['getSigningSecret']> {
    return this.secrets.getSigningSecret(
      scope,
      endpointId,
      keyId,
      this.environment.WEBHOOK_MASTER_KEY,
    );
  }
}

export interface CreateWebhookEndpointCommand {
  readonly name: string;
  readonly url: string;
  readonly keyId: string;
}

@Injectable()
export class WebhookService {
  public constructor(
    private readonly secrets: WebhookSecretStore,
    private readonly deliveries: WebhookDeliveryStore,
    @Inject(RUNTIME_ENVIRONMENT) private readonly environment: RuntimeEnvironment,
  ) {}

  public createEndpoint(
    context: TenantContext,
    command: CreateWebhookEndpointCommand,
    idempotencyKey: string,
    correlationId: string,
  ): ReturnType<WebhookSecretStore['createEndpoint']> {
    requireAnyRole(context, ['tenant_admin', 'platform_admin']);
    const request: JsonObject = {
      keyId: command.keyId,
      name: command.name,
      url: command.url,
    };
    return this.secrets.createEndpoint(
      context,
      {
        ...command,
        signingSecret: randomBytes(32).toString('base64url'),
        correlationId,
        idempotencyKeyHash: sha256Hex(idempotencyKey),
        requestFingerprint: createIdempotencyFingerprint({
          operation: 'webhook-endpoint.create',
          principalId: context.principalId,
          request,
        }),
      },
      this.environment.WEBHOOK_MASTER_KEY,
    );
  }

  public updateEndpoint(
    context: TenantContext,
    endpointId: string,
    command: { readonly name?: string; readonly url?: string; readonly active?: boolean },
    correlationId: string,
  ): ReturnType<WebhookSecretStore['updateEndpoint']> {
    requireAnyRole(context, ['tenant_admin', 'platform_admin']);
    return this.secrets.updateEndpoint(context, endpointId, command, correlationId);
  }

  public replayDelivery(
    context: TenantContext,
    deliveryId: string,
    idempotencyKey: string,
    correlationId: string,
  ): ReturnType<WebhookDeliveryStore['createReplay']> {
    requireAnyRole(context, ['operator', 'tenant_admin', 'platform_admin']);
    return this.deliveries.createReplay(context, deliveryId, {
      actorPrincipalId: context.principalId,
      actorPrincipalKind: context.principalKind,
      correlationId,
      idempotencyKeyHash: sha256Hex(idempotencyKey),
      requestFingerprint: createIdempotencyFingerprint({
        operation: 'webhook-delivery.replay',
        principalId: context.principalId,
        request: { deliveryId },
      }),
    });
  }
}
