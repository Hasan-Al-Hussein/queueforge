import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { RuntimeEnvironment } from '@queueforge/config';
import type { TenantContext } from '@queueforge/contracts';
import { createIdempotencyFingerprint, sha256Hex } from '@queueforge/domain';
import { ApiClientStore, type ApiClientRecord, type ApiClientRole } from '@queueforge/persistence';

import { requireAnyRole } from './authorization.js';
import { RUNTIME_ENVIRONMENT } from './configuration.js';
import { ApplicationError } from './errors.js';

const API_KEY_SECRET_BYTES = 32;
const API_KEY_ID_BYTES = 12;
const API_KEY_DOMAIN = 'queueforge-api-key-v1\0';
const TENANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_ID_PATTERN = /^qf_[0-9a-f]{24}$/u;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface CreatedApiClient {
  readonly apiKey: string | null;
  readonly client: ApiClientView;
  readonly replayed: boolean;
}

export interface ApiClientView {
  readonly createdAt: string;
  readonly id: string;
  readonly keyId: string;
  readonly lastUsedAt: string | null;
  readonly name: string;
  readonly revokedAt: string | null;
  readonly role: ApiClientRole;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function view(record: ApiClientRecord): ApiClientView {
  return {
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    keyId: record.keyId,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    name: record.name,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    role: record.role,
  };
}

@Injectable()
export class ApiClientService {
  public constructor(
    private readonly apiClients: ApiClientStore,
    @Inject(RUNTIME_ENVIRONMENT) private readonly environment: RuntimeEnvironment,
  ) {}

  public async create(
    context: TenantContext,
    input: { readonly name: string; readonly role: ApiClientRole },
    idempotencyKey: string,
    correlationId: string,
  ): Promise<CreatedApiClient> {
    requireAnyRole(context, ['tenant_admin', 'platform_admin']);
    if (context.principalKind !== 'user') {
      throw new ApplicationError('AUTHORIZATION_DENIED', 'A user administrator is required');
    }
    const keyId = `qf_${randomBytes(API_KEY_ID_BYTES).toString('hex')}`;
    const secret = randomBytes(API_KEY_SECRET_BYTES).toString('base64url');
    const result = await this.apiClients.create(context, {
      correlationId,
      idempotencyKeyHash: sha256Hex(idempotencyKey),
      keyId,
      name: input.name,
      requestFingerprint: createIdempotencyFingerprint({
        operation: 'api-client.create',
        principalId: context.principalId,
        request: { name: input.name, role: input.role },
      }),
      role: input.role,
      secretHash: this.hashSecret(secret),
    });
    return {
      apiKey: result.replayed ? null : `${context.tenantId}.${keyId}.${secret}`,
      client: view(result.record),
      replayed: result.replayed,
    };
  }

  public async list(context: TenantContext): Promise<readonly ApiClientView[]> {
    requireAnyRole(context, ['tenant_admin', 'platform_admin']);
    return (await this.apiClients.list(context)).map(view);
  }

  public async revoke(
    context: TenantContext,
    apiClientId: string,
    correlationId: string,
  ): Promise<ApiClientView> {
    requireAnyRole(context, ['tenant_admin', 'platform_admin']);
    return view(await this.apiClients.revoke(context, apiClientId, correlationId));
  }

  public async verify(rawApiKey: string): Promise<TenantContext> {
    const parsed = this.parse(rawApiKey);
    const credential =
      parsed === null
        ? null
        : await this.apiClients.findActiveCredential(parsed.tenantId, parsed.keyId);
    const candidateHash = this.hashSecret(parsed?.secret ?? 'invalid-api-key');
    const expectedHash = credential?.secretHash ?? this.hashSecret('missing-api-key');
    if (credential === null || !safeEqual(candidateHash, expectedHash)) {
      throw new ApplicationError('AUTHENTICATION_REQUIRED', 'API key is invalid or revoked');
    }
    const stillActive = await this.apiClients.markUsedIfActive(credential.tenantId, credential.id);
    if (!stillActive) {
      throw new ApplicationError('AUTHENTICATION_REQUIRED', 'API key is invalid or revoked');
    }
    return {
      tenantId: credential.tenantId,
      principalId: credential.id,
      principalKind: 'api_client',
      role: credential.role,
    };
  }

  private hashSecret(secret: string): string {
    return createHmac('sha256', this.environment.REFRESH_TOKEN_PEPPER)
      .update(API_KEY_DOMAIN, 'utf8')
      .update(secret, 'utf8')
      .digest('hex');
  }

  private parse(
    rawApiKey: string,
  ): { readonly keyId: string; readonly secret: string; readonly tenantId: string } | null {
    const segments = rawApiKey.split('.');
    if (segments.length !== 3) {
      return null;
    }
    const [tenantId, keyId, secret] = segments;
    if (
      tenantId === undefined ||
      keyId === undefined ||
      secret === undefined ||
      !TENANT_ID_PATTERN.test(tenantId) ||
      !KEY_ID_PATTERN.test(keyId) ||
      !SECRET_PATTERN.test(secret)
    ) {
      return null;
    }
    return { keyId, secret, tenantId };
  }
}
