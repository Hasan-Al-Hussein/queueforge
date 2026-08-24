import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { JsonObject, TenantContext } from '@queueforge/contracts';

import { PersistenceConflictError } from '../errors.js';
import { PersistenceNotFoundError } from '../errors.js';
import { queryRows } from '../query-result.js';
import { requireTenantId, type TenantScope } from '../tenant-scope.js';
import { withSerializableRetry } from '../transaction-retry.js';
import { appendAuditEvent } from './audit.store.js';
import { deleteExpiredIdempotencyRecord } from './idempotency-record.js';

export const WEBHOOK_SECRET_AAD_PREFIX = 'queueforge.webhook-secret.v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export interface WebhookSecretBinding {
  readonly tenantId: string;
  readonly endpointId: string;
  readonly keyId: string;
  readonly masterKeyVersion: number;
}

export interface EncryptedWebhookSecret {
  readonly ciphertext: Buffer;
  readonly iv: Buffer;
  readonly authTag: Buffer;
}

export interface CreateWebhookEndpointStoreInput {
  readonly name: string;
  readonly url: string;
  readonly keyId: string;
  readonly signingSecret: string;
  readonly correlationId: string;
  readonly idempotencyKeyHash: string;
  readonly requestFingerprint: string;
}

export interface WebhookEndpointRecord {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly active: boolean;
  readonly keyId: string;
  readonly updatedAt: string;
}

export interface CreatedWebhookEndpoint {
  readonly endpoint: WebhookEndpointRecord;
  readonly signingSecret: string | null;
  readonly replayed: boolean;
}

export interface InboundWebhookClientRecord {
  readonly tenantId: string;
  readonly endpointId: string;
  readonly keyId: string;
  readonly signingSecret: string;
}

function decodeMasterKey(masterKeyBase64: string): Buffer {
  const key = Buffer.from(masterKeyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('Webhook master key must decode to exactly 32 bytes');
  }
  return key;
}

function additionalAuthenticatedData(binding: WebhookSecretBinding): Buffer {
  return Buffer.from(
    `${WEBHOOK_SECRET_AAD_PREFIX}|${binding.tenantId}|${binding.endpointId}|${binding.keyId}|${binding.masterKeyVersion}`,
    'utf8',
  );
}

export function encryptWebhookSecret(
  masterKeyBase64: string,
  binding: WebhookSecretBinding,
  plaintext: string,
): EncryptedWebhookSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, decodeMasterKey(masterKeyBase64), iv);
  cipher.setAAD(additionalAuthenticatedData(binding));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function decryptWebhookSecret(
  masterKeyBase64: string,
  binding: WebhookSecretBinding,
  encrypted: EncryptedWebhookSecret,
): string {
  const decipher = createDecipheriv(ALGORITHM, decodeMasterKey(masterKeyBase64), encrypted.iv);
  decipher.setAAD(additionalAuthenticatedData(binding));
  decipher.setAuthTag(encrypted.authTag);
  return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString('utf8');
}

@Injectable()
export class WebhookSecretStore {
  public constructor(private readonly dataSource: DataSource) {}

  public async findInboundClient(
    tenantSlug: string,
    endpointId: string,
    keyId: string,
    masterKeyBase64: string,
  ): Promise<InboundWebhookClientRecord | null> {
    const rows = (await this.dataSource.query(
      `SELECT endpoint.tenant_id, secret.ciphertext, secret.iv, secret.auth_tag,
              secret.master_key_version
       FROM webhook_endpoints endpoint
       JOIN tenants tenant ON tenant.id = endpoint.tenant_id
       JOIN webhook_secrets secret
         ON secret.tenant_id = endpoint.tenant_id AND secret.endpoint_id = endpoint.id
       WHERE tenant.slug = $1 AND endpoint.id = $2 AND endpoint.is_enabled
         AND secret.key_id = $3 AND secret.status IN ('active','retiring')
         AND (secret.expires_at IS NULL OR secret.expires_at > clock_timestamp())
       LIMIT 1`,
      [tenantSlug, endpointId, keyId],
    )) as unknown as Array<{
      tenant_id: string;
      ciphertext: Buffer;
      iv: Buffer;
      auth_tag: Buffer;
      master_key_version: number;
    }>;
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      tenantId: row.tenant_id,
      endpointId,
      keyId,
      signingSecret: decryptWebhookSecret(
        masterKeyBase64,
        {
          tenantId: row.tenant_id,
          endpointId,
          keyId,
          masterKeyVersion: row.master_key_version,
        },
        { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag },
      ),
    };
  }

  public async createEndpoint(
    context: TenantContext,
    input: CreateWebhookEndpointStoreInput,
    masterKeyBase64: string,
  ): Promise<CreatedWebhookEndpoint> {
    const tenantId = requireTenantId(context);
    return withSerializableRetry(this.dataSource, async (manager) => {
      const endpointScope = 'webhooks:endpoints:create';
      await deleteExpiredIdempotencyRecord(
        manager,
        tenantId,
        endpointScope,
        input.idempotencyKeyHash,
      );
      await manager.query(
        `INSERT INTO idempotency_records
           (tenant_id, id, endpoint_scope, key_hash, request_fingerprint,
            principal_id, principal_kind, status, expires_at)
         VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6, 'processing',
                 clock_timestamp() + interval '24 hours')
         ON CONFLICT (tenant_id, endpoint_scope, key_hash) DO NOTHING`,
        [
          tenantId,
          endpointScope,
          input.idempotencyKeyHash,
          input.requestFingerprint,
          context.principalId,
          context.principalKind,
        ],
      );
      const idempotencyRows = (await manager.query(
        `SELECT request_fingerprint, principal_id, status, response_body
         FROM idempotency_records
         WHERE tenant_id = $1 AND endpoint_scope = $2 AND key_hash = $3 FOR UPDATE`,
        [tenantId, endpointScope, input.idempotencyKeyHash],
      )) as unknown as Array<{
        request_fingerprint: string;
        principal_id: string;
        status: 'processing' | 'completed';
        response_body: JsonObject | null;
      }>;
      const idempotency = idempotencyRows[0];
      if (
        idempotency === undefined ||
        idempotency.request_fingerprint !== input.requestFingerprint ||
        idempotency.principal_id !== context.principalId
      ) {
        throw new PersistenceConflictError(
          'IDEMPOTENCY_KEY_REUSE',
          'Idempotency key was already used for another webhook endpoint',
        );
      }
      const replayed = idempotency.status === 'completed';
      let endpointId: string;
      if (replayed) {
        const storedId = idempotency.response_body?.endpointId;
        if (typeof storedId !== 'string') {
          throw new PersistenceConflictError(
            'IDEMPOTENCY_RESULT_INVALID',
            'Stored webhook endpoint result is incomplete',
          );
        }
        endpointId = storedId;
      } else {
        endpointId = randomUUID();
        const encrypted = encryptWebhookSecret(
          masterKeyBase64,
          { tenantId, endpointId, keyId: input.keyId, masterKeyVersion: 1 },
          input.signingSecret,
        );
        await manager.query(
          `INSERT INTO webhook_endpoints
             (tenant_id, id, name, url, is_enabled, created_by_principal_id)
           VALUES ($1, $2, $3, $4, true, $5)`,
          [tenantId, endpointId, input.name, input.url, context.principalId],
        );
        await manager.query(
          `INSERT INTO webhook_secrets
             (tenant_id, id, endpoint_id, key_id, ciphertext, iv, auth_tag,
              master_key_version, status)
           VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6, 1, 'active')`,
          [
            tenantId,
            endpointId,
            input.keyId,
            encrypted.ciphertext,
            encrypted.iv,
            encrypted.authTag,
          ],
        );
        await appendAuditEvent(manager, context, {
          eventType: 'webhook.endpoint_created',
          actorPrincipalId: context.principalId,
          actorPrincipalKind: context.principalKind,
          resourceType: 'webhook_endpoint',
          resourceId: endpointId,
          correlationId: input.correlationId,
          metadata: { keyId: input.keyId },
        });
        await manager.query(
          `UPDATE idempotency_records
           SET status = 'completed', response_status = 201,
               response_body = jsonb_build_object('endpointId', $4::text),
               updated_at = clock_timestamp()
           WHERE tenant_id = $1 AND endpoint_scope = $2 AND key_hash = $3`,
          [tenantId, endpointScope, input.idempotencyKeyHash, endpointId],
        );
      }
      const rows = (await manager.query(
        `SELECT endpoint.id, endpoint.name, endpoint.url, endpoint.is_enabled,
                endpoint.updated_at, secret.key_id, secret.ciphertext, secret.iv,
                secret.auth_tag, secret.master_key_version
         FROM webhook_endpoints endpoint
         JOIN webhook_secrets secret
           ON secret.tenant_id = endpoint.tenant_id AND secret.endpoint_id = endpoint.id
          AND secret.status = 'active'
         WHERE endpoint.tenant_id = $1 AND endpoint.id = $2`,
        [tenantId, endpointId],
      )) as unknown as Array<{
        id: string;
        name: string;
        url: string;
        is_enabled: boolean;
        updated_at: Date;
        key_id: string;
        ciphertext: Buffer;
        iv: Buffer;
        auth_tag: Buffer;
        master_key_version: number;
      }>;
      const endpoint = rows[0];
      if (endpoint === undefined) {
        throw new PersistenceNotFoundError('webhook endpoint');
      }
      const signingSecret = replayed
        ? null
        : decryptWebhookSecret(
            masterKeyBase64,
            {
              tenantId,
              endpointId,
              keyId: endpoint.key_id,
              masterKeyVersion: endpoint.master_key_version,
            },
            { ciphertext: endpoint.ciphertext, iv: endpoint.iv, authTag: endpoint.auth_tag },
          );
      return {
        endpoint: {
          id: endpoint.id,
          name: endpoint.name,
          url: endpoint.url,
          active: endpoint.is_enabled,
          keyId: endpoint.key_id,
          updatedAt: endpoint.updated_at.toISOString(),
        },
        signingSecret,
        replayed,
      };
    });
  }

  public async updateEndpoint(
    context: TenantContext,
    endpointId: string,
    input: { readonly name?: string; readonly url?: string; readonly active?: boolean },
    correlationId: string,
  ): Promise<WebhookEndpointRecord> {
    const tenantId = requireTenantId(context);
    return this.dataSource.transaction(async (manager) => {
      const rows = queryRows<{
        id: string;
        name: string;
        url: string;
        is_enabled: boolean;
        updated_at: Date;
      }>(
        await manager.query(
          `UPDATE webhook_endpoints
         SET name = COALESCE($3, name), url = COALESCE($4, url),
             is_enabled = COALESCE($5, is_enabled), updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2
         RETURNING id, name, url, is_enabled, updated_at`,
          [tenantId, endpointId, input.name ?? null, input.url ?? null, input.active ?? null],
        ),
      );
      const endpoint = rows[0];
      if (endpoint === undefined) {
        throw new PersistenceNotFoundError('webhook endpoint');
      }
      const secrets = (await manager.query(
        `SELECT key_id FROM webhook_secrets
         WHERE tenant_id = $1 AND endpoint_id = $2 AND status = 'active' LIMIT 1`,
        [tenantId, endpointId],
      )) as unknown as Array<{ key_id: string }>;
      const keyId = secrets[0]?.key_id;
      if (keyId === undefined || keyId.length === 0) {
        throw new PersistenceNotFoundError('active webhook signing secret');
      }
      await appendAuditEvent(manager, context, {
        eventType:
          input.active === false ? 'webhook.endpoint_disabled' : 'webhook.endpoint_updated',
        actorPrincipalId: context.principalId,
        actorPrincipalKind: context.principalKind,
        resourceType: 'webhook_endpoint',
        resourceId: endpointId,
        correlationId,
        metadata: { fields: Object.keys(input) },
      });
      return {
        id: endpoint.id,
        name: endpoint.name,
        url: endpoint.url,
        active: endpoint.is_enabled,
        keyId,
        updatedAt: endpoint.updated_at.toISOString(),
      };
    });
  }

  public async getSigningSecret(
    scope: TenantScope,
    endpointId: string,
    keyId: string,
    masterKeyBase64: string,
  ): Promise<string> {
    const tenantId = requireTenantId(scope);
    const rows = (await this.dataSource.query(
      `SELECT ciphertext, iv, auth_tag, master_key_version
       FROM webhook_secrets
       WHERE tenant_id = $1 AND endpoint_id = $2 AND key_id = $3
         AND status IN ('active','retiring')
         AND (expires_at IS NULL OR expires_at > clock_timestamp())
       LIMIT 1`,
      [tenantId, endpointId, keyId],
    )) as unknown as Array<{
      ciphertext: Buffer;
      iv: Buffer;
      auth_tag: Buffer;
      master_key_version: number;
    }>;
    const row = rows[0];
    if (row === undefined) {
      throw new PersistenceNotFoundError('active webhook signing secret');
    }
    try {
      return decryptWebhookSecret(
        masterKeyBase64,
        { tenantId, endpointId, keyId, masterKeyVersion: row.master_key_version },
        { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag },
      );
    } catch {
      throw new PersistenceConflictError(
        'WEBHOOK_SECRET_INVALID',
        'Webhook signing secret could not be decrypted',
      );
    }
  }

  public async storeActiveSecret(
    scope: TenantScope,
    endpointId: string,
    keyId: string,
    plaintext: string,
    masterKeyBase64: string,
    masterKeyVersion = 1,
  ): Promise<string> {
    const tenantId = requireTenantId(scope);
    const encrypted = encryptWebhookSecret(
      masterKeyBase64,
      { tenantId, endpointId, keyId, masterKeyVersion },
      plaintext,
    );
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE webhook_secrets
         SET status = 'retiring', expires_at = clock_timestamp() + interval '1 day',
             updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND endpoint_id = $2 AND status = 'active'`,
        [tenantId, endpointId],
      );
      const id = randomUUID();
      await manager.query(
        `INSERT INTO webhook_secrets
           (tenant_id, id, endpoint_id, key_id, ciphertext, iv, auth_tag,
            master_key_version, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')`,
        [
          tenantId,
          id,
          endpointId,
          keyId,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.authTag,
          masterKeyVersion,
        ],
      );
      return id;
    });
  }
}
