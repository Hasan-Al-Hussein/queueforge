import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { OperationsService } from '@queueforge/application';
import type { ApiClientService, AuthService } from '@queueforge/application';
import type { TenantContext } from '@queueforge/contracts';
import type { OperationsStore, ReadModelStore } from '@queueforge/persistence';

import { OperationsController } from '../controllers/operations.controller.js';
import { AccessTokenGuard } from './auth.guard.js';
import type { QueueForgeRequest } from './http-context.js';

const TENANT_CONTEXT: TenantContext = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  principalId: '20000000-0000-4000-8000-000000000001',
  principalKind: 'user',
  role: 'operator',
  sessionId: '30000000-0000-4000-8000-000000000001',
};

function executionContext(request: QueueForgeRequest): ExecutionContext {
  return {
    getClass: () => class TestController {},
    getHandler: () => (): void => undefined,
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function requestWithAuthorization(value?: string): QueueForgeRequest {
  return {
    header: (name: string) => (name === 'authorization' ? value : undefined),
  } as QueueForgeRequest;
}

describe('AccessTokenGuard', () => {
  it('bypasses token verification only for explicit public metadata', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) };
    const verifyAccessToken = jest.fn();
    const guard = new AccessTokenGuard(
      reflector as unknown as Reflector,
      { verifyAccessToken } as unknown as AuthService,
      {} as ApiClientService,
    );

    await expect(guard.canActivate(executionContext(requestWithAuthorization()))).resolves.toBe(
      true,
    );
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'Basic abc', 'Bearer   '])(
    'rejects a missing or malformed bearer credential (%s)',
    async (authorization) => {
      const guard = new AccessTokenGuard(
        { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector,
        { verifyAccessToken: jest.fn() } as unknown as AuthService,
        { verify: jest.fn() } as unknown as ApiClientService,
      );
      await expect(
        guard.canActivate(executionContext(requestWithAuthorization(authorization))),
      ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    },
  );

  it('overwrites any spoofed request tenant with the token-authoritative session context', async () => {
    const request = requestWithAuthorization('Bearer signed-access-token');
    request.tenantContext = { ...TENANT_CONTEXT, tenantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' };
    const verifyAccessToken = jest.fn().mockResolvedValue(TENANT_CONTEXT);
    const guard = new AccessTokenGuard(
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector,
      { verifyAccessToken } as unknown as AuthService,
      { verify: jest.fn() } as unknown as ApiClientService,
    );

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(true);
    expect(verifyAccessToken).toHaveBeenCalledWith('signed-access-token');
    expect(request.tenantContext).toBe(TENANT_CONTEXT);
  });

  it('routes ApiKey credentials only to the API-client verifier', async () => {
    const request = requestWithAuthorization('ApiKey qf_live_credential');
    const verifyAccessToken = jest.fn();
    const verifyApiKey = jest.fn().mockResolvedValue({
      ...TENANT_CONTEXT,
      principalKind: 'api_client',
      sessionId: undefined,
    });
    const guard = new AccessTokenGuard(
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector,
      { verifyAccessToken } as unknown as AuthService,
      { verify: verifyApiKey } as unknown as ApiClientService,
    );

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(true);
    expect(verifyApiKey).toHaveBeenCalledWith('qf_live_credential');
    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect(request.tenantContext).toMatchObject({ principalKind: 'api_client' });
  });
});

describe('transport RBAC boundary', () => {
  it('keeps a viewer out of operator routes before invoking the read store', () => {
    const queueOverview = jest.fn();
    const service = new OperationsService(
      {} as OperationsStore,
      { queueOverview } as unknown as ReadModelStore,
    );
    const controller = new OperationsController(service);
    const viewer: TenantContext = { ...TENANT_CONTEXT, role: 'viewer' };

    expect(() => controller.queues(viewer)).toThrow(
      expect.objectContaining({ code: 'AUTHORIZATION_DENIED' }),
    );
    expect(queueOverview).not.toHaveBeenCalled();
  });

  it('passes the token-derived tenant context unchanged for an allowed operator', async () => {
    const queueOverview = jest.fn().mockResolvedValue([]);
    const service = new OperationsService(
      {} as OperationsStore,
      { queueOverview } as unknown as ReadModelStore,
    );
    const controller = new OperationsController(service);

    await expect(controller.queues(TENANT_CONTEXT)).resolves.toEqual([]);
    expect(queueOverview).toHaveBeenCalledWith(TENANT_CONTEXT);
  });
});
