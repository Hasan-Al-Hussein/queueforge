import { createHmac } from 'node:crypto';

import type { JwtService } from '@nestjs/jwt';
import { argon2id, hash, verify } from 'argon2';

import type { RuntimeEnvironment } from '@queueforge/config';
import type { TenantContext } from '@queueforge/contracts';
import type {
  AdminStore,
  IdentityStore,
  ReadModelStore,
  RequestSubmissionStore,
  WebhookSecretStore,
} from '@queueforge/persistence';

import { AdminService } from './admin.service.js';
import { AuthService } from './auth.service.js';
import { requireAnyRole } from './authorization.js';
import { InboundWebhookService } from './inbound-webhook.service.js';
import { RequestService } from './request.service.js';

const environment = {
  ACCESS_TOKEN_TTL_SECONDS: 600,
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_AUDIENCE: 'queueforge-api',
  JWT_ISSUER: 'queueforge-local',
  REFRESH_FAMILY_TTL_SECONDS: 2_592_000,
  REFRESH_TOKEN_PEPPER: 'b'.repeat(32),
  REFRESH_TOKEN_TTL_SECONDS: 604_800,
  WEBHOOK_CLOCK_SKEW_SECONDS: 300,
  WEBHOOK_MASTER_KEY: Buffer.alloc(32, 5).toString('base64'),
} as RuntimeEnvironment;

describe('authorization capabilities', () => {
  const context = (role: TenantContext['role']): TenantContext => ({
    tenantId: '10000000-0000-4000-8000-000000000001',
    principalId: '20000000-0000-4000-8000-000000000001',
    principalKind: 'user',
    role,
  });

  it('does not let lateral approver and operator roles inherit each other', () => {
    expect(() => requireAnyRole(context('approver'), ['operator'])).toThrow('not permitted');
    expect(() => requireAnyRole(context('operator'), ['approver'])).toThrow('not permitted');
    expect(() =>
      requireAnyRole(context('tenant_admin'), ['tenant_admin', 'platform_admin']),
    ).not.toThrow();
  });
});

describe('access-token session validation', () => {
  it('verifies the same raw Argon2 password format used by bootstrap seeding', async () => {
    const password = 'correct horse battery staple';
    const passwordHash = await hash(password, {
      type: argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    const membership = {
      tenantId: '10000000-0000-4000-8000-000000000001',
      tenantName: 'Tenant',
      tenantSlug: 'tenant',
      role: 'tenant_admin' as const,
    };
    const identity = {
      findUserForLogin: jest.fn().mockResolvedValue({
        id: '20000000-0000-4000-8000-000000000001',
        email: 'admin@example.test',
        displayName: 'Admin',
        passwordHash,
        platformRole: 'platform_admin',
        isActive: true,
      }),
      listMemberships: jest.fn().mockResolvedValue([membership]),
      createRefreshSession: jest.fn().mockResolvedValue({
        familyId: '70000000-0000-4000-8000-000000000001',
        tokenId: '71000000-0000-4000-8000-000000000001',
      }),
      recordAuthEvent: jest.fn().mockResolvedValue(undefined),
    };
    const signAsync = jest.fn().mockResolvedValue('access-token');
    const service = new AuthService(
      identity as unknown as IdentityStore,
      { signAsync } as unknown as JwtService,
      environment,
    );
    await expect(
      service.login(
        { email: 'admin@example.test', password },
        {
          correlationId: '90000000-0000-4000-8000-000000000001',
          sourceIp: '127.0.0.1',
          userAgent: 'jest',
        },
      ),
    ).resolves.toMatchObject({ session: { accessToken: 'access-token' } });
    expect(signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'platform_admin' }),
      expect.objectContaining({ algorithm: 'HS256' }),
    );
  });

  it('uses current database membership state and an explicit HS256 allowlist', async () => {
    const verifyAsync = jest.fn().mockResolvedValue({
      sub: '20000000-0000-4000-8000-000000000001',
      tid: '10000000-0000-4000-8000-000000000001',
      role: 'operator',
      pk: 'user',
      sid: '70000000-0000-4000-8000-000000000001',
      email: 'admin@example.test',
      platformRole: null,
    });
    const identity = {
      validateAccessSession: jest.fn().mockResolvedValue({
        user: {
          id: '20000000-0000-4000-8000-000000000001',
          email: 'admin@example.test',
          displayName: 'Admin',
          platformRole: null,
          isActive: true,
        },
        membership: {
          tenantId: '10000000-0000-4000-8000-000000000001',
          tenantName: 'Tenant',
          tenantSlug: 'tenant',
          role: 'approver',
        },
      }),
    };
    const service = new AuthService(
      identity as unknown as IdentityStore,
      { verifyAsync } as unknown as JwtService,
      environment,
    );
    await expect(service.verifyAccessToken('signed-token')).resolves.toMatchObject({
      role: 'approver',
    });
    expect(verifyAsync).toHaveBeenCalledWith(
      'signed-token',
      expect.objectContaining({ algorithms: ['HS256'] }),
    );
  });

  it('rejects a signed token after its refresh family is no longer active', async () => {
    const identity = { validateAccessSession: jest.fn().mockResolvedValue(null) };
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        sub: '20000000-0000-4000-8000-000000000001',
        tid: '10000000-0000-4000-8000-000000000001',
        role: 'operator',
        pk: 'user',
        sid: '70000000-0000-4000-8000-000000000001',
      }),
    };
    const service = new AuthService(
      identity as unknown as IdentityStore,
      jwt as unknown as JwtService,
      environment,
    );
    await expect(service.verifyAccessToken('revoked-token')).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });
  });
});

describe('refresh-token input boundary', () => {
  it('rejects malformed cookie identifiers and secrets before PostgreSQL access', async () => {
    const rotateRefresh = jest.fn();
    const service = new AuthService(
      { rotateRefresh } as unknown as IdentityStore,
      {} as JwtService,
      environment,
    );

    await expect(
      service.refresh('-'.repeat(36) + '.short', 'csrf-token', 'csrf-token', {
        correlationId: '40000000-0000-4000-8000-000000000001',
        sourceIp: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(rotateRefresh).not.toHaveBeenCalled();
  });
});

describe('workflow request transport invariants', () => {
  it('binds REST and GraphQL submissions to one idempotency scope and server correlation ID', async () => {
    const submit = jest.fn().mockResolvedValue({
      body: { request: { id: '50000000-0000-4000-8000-000000000001' } },
      replayed: false,
      statusCode: 201,
    });
    const service = new RequestService(
      { submit } as unknown as RequestSubmissionStore,
      {} as ReadModelStore,
    );
    const context: TenantContext = {
      tenantId: '10000000-0000-4000-8000-000000000001',
      principalId: '20000000-0000-4000-8000-000000000001',
      principalKind: 'user',
      role: 'operator',
    };
    const input = { workflowKey: 'expense_review', payload: { amount: 42 } };
    const correlationId = '30000000-0000-4000-8000-000000000001';

    await service.submit(context, input, 'same-key', correlationId, 'rest');
    await service.submit(context, input, 'same-key', correlationId, 'graphql');

    const [restCall, graphqlCall] = submit.mock.calls.map(
      ([value]) =>
        value as { endpointScope: string; correlationId: string; requestFingerprint: string },
    );
    expect(restCall).toMatchObject({ endpointScope: 'requests:submit', correlationId });
    expect(graphqlCall).toMatchObject({ endpointScope: 'requests:submit', correlationId });
    expect(graphqlCall?.requestFingerprint).toBe(restCall?.requestFingerprint);
  });
});

describe('admin idempotency binding', () => {
  it('uses a keyed password binding instead of a fast database-verifiable password hash', async () => {
    const createMembership = jest.fn().mockResolvedValue({ id: 'membership-id' });
    const service = new AdminService({ createMembership } as unknown as AdminStore, environment);
    const context: TenantContext = {
      tenantId: '10000000-0000-4000-8000-000000000001',
      principalId: '20000000-0000-4000-8000-000000000001',
      principalKind: 'user',
      role: 'tenant_admin',
    };
    const command = {
      email: 'new-user@example.test',
      role: 'operator' as const,
      displayName: 'New User',
      initialPassword: 'correct horse battery staple',
    };

    await service.createMembership(context, command, 'idempotency-key', 'correlation-id');
    await service.createMembership(context, command, 'idempotency-key', 'correlation-id');
    await service.createMembership(
      context,
      { ...command, initialPassword: `${command.initialPassword}!` },
      'idempotency-key',
      'correlation-id',
    );

    const [first, replay, changed] = createMembership.mock.calls.map(
      ([, value]) => value as { passwordHash: string; requestFingerprint: string },
    );
    expect(first?.requestFingerprint).toBe(replay?.requestFingerprint);
    expect(first?.requestFingerprint).not.toBe(changed?.requestFingerprint);
    expect(first?.requestFingerprint).not.toContain(command.initialPassword);
    await expect(verify(first?.passwordHash ?? '', command.initialPassword)).resolves.toBe(true);
  });
});

describe('inbound webhook authentication', () => {
  const tenantId = '10000000-0000-4000-8000-000000000001';
  const endpointId = '50000000-0000-4000-8000-000000000001';
  const eventId = '60000000-0000-4000-8000-000000000001';
  const secret = 'inbound-signing-secret';
  const rawBody = Buffer.from(
    JSON.stringify({ workflowKey: 'expense_review', payload: { amount: 42 } }),
    'utf8',
  );

  function createService(): {
    secrets: { findInboundClient: jest.Mock };
    submissions: { submitInboundWebhook: jest.Mock };
    service: InboundWebhookService;
  } {
    const secrets = {
      findInboundClient: jest.fn().mockResolvedValue({
        tenantId,
        endpointId,
        keyId: 'local-v1',
        signingSecret: secret,
      }),
    };
    const submissions = {
      submitInboundWebhook: jest.fn().mockResolvedValue({
        accepted: true,
        duplicate: false,
        eventId,
        requestId: '80000000-0000-4000-8000-000000000001',
      }),
    };
    return {
      secrets,
      submissions,
      service: new InboundWebhookService(
        secrets as unknown as WebhookSecretStore,
        submissions as unknown as RequestSubmissionStore,
        environment,
      ),
    };
  }

  it('verifies raw bytes before submitting a durable inbound request', async () => {
    const fixture = createService();
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const nonce = 'nonce-1234567890abcdef';
    const idempotencyKey = 'idempotency-key-123';
    const signature = createHmac('sha256', secret)
      .update(Buffer.from(`${timestamp}.${nonce}.${eventId}.${idempotencyKey}.local-v1.`, 'utf8'))
      .update(rawBody)
      .digest('hex');
    await expect(
      fixture.service.accept(
        'acme-demo',
        endpointId,
        rawBody,
        {
          eventId,
          idempotencyKey,
          keyId: 'local-v1',
          nonce,
          signature,
          timestamp,
        },
        '90000000-0000-4000-8000-000000000001',
      ),
    ).resolves.toMatchObject({ accepted: true, eventId });
    expect(fixture.submissions.submitInboundWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointId,
        externalEventId: eventId,
        source: 'inbound_webhook',
      }),
    );
  });

  it('retains a future-timestamp nonce through the complete signature validity window', async () => {
    const fixture = createService();
    const timestampSeconds =
      Math.floor(Date.now() / 1_000) + environment.WEBHOOK_CLOCK_SKEW_SECONDS;
    const timestamp = String(timestampSeconds);
    const nonce = 'future-nonce-1234567890';
    const idempotencyKey = 'future-idempotency-key';
    const signature = createHmac('sha256', secret)
      .update(Buffer.from(`${timestamp}.${nonce}.${eventId}.${idempotencyKey}.local-v1.`, 'utf8'))
      .update(rawBody)
      .digest('hex');

    await fixture.service.accept(
      'acme-demo',
      endpointId,
      rawBody,
      { eventId, idempotencyKey, keyId: 'local-v1', nonce, signature, timestamp },
      '90000000-0000-4000-8000-000000000001',
    );

    expect(fixture.submissions.submitInboundWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        nonceExpiresAt: new Date(
          (timestampSeconds + environment.WEBHOOK_CLOCK_SKEW_SECONDS + 1) * 1_000,
        ),
      }),
    );
  });

  it('rejects a bad signature without parsing or submitting the body', async () => {
    const fixture = createService();
    const timestamp = String(Math.floor(Date.now() / 1_000));
    await expect(
      fixture.service.accept(
        'acme-demo',
        endpointId,
        Buffer.from('not-json', 'utf8'),
        {
          eventId,
          idempotencyKey: 'idempotency-key-123',
          keyId: 'local-v1',
          nonce: 'nonce-1234567890abcdef',
          signature: '00'.repeat(32),
          timestamp,
        },
        '90000000-0000-4000-8000-000000000001',
      ),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
    expect(fixture.submissions.submitInboundWebhook).not.toHaveBeenCalled();
  });
});
