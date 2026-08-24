import { UnprocessableEntityException } from '@nestjs/common';
import type { Response } from 'express';

import type { OperationsService, RequestService, WebhookService } from '@queueforge/application';
import type { JsonObject, TenantContext, WorkflowRequestView } from '@queueforge/contracts';

import { AuditController } from './operations.controller.js';
import { RequestController } from './request.controller.js';
import { WebhookController } from './webhook.controller.js';

const TENANT_CONTEXT: TenantContext = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  principalId: '20000000-0000-4000-8000-000000000001',
  principalKind: 'user',
  role: 'tenant_admin',
  sessionId: '30000000-0000-4000-8000-000000000001',
};
const CORRELATION_ID = '40000000-0000-4000-8000-000000000001';

const INVALID_AUDIT_QUERIES: ReadonlyArray<
  readonly [Record<string, string | string[] | undefined>, string]
> = [
  [{ unexpected: 'value' }, 'Unknown audit filter'],
  [{ eventType: ['auth.login'] }, 'Audit event type filter is invalid'],
  [{ eventType: 'AUTH LOGIN' }, 'Audit event type filter is invalid'],
  [{ page: '0' }, 'Audit pagination is invalid'],
];

const requestView: WorkflowRequestView = {
  id: '50000000-0000-4000-8000-000000000001',
  workflowId: '60000000-0000-4000-8000-000000000001',
  workflowVersionId: '70000000-0000-4000-8000-000000000001',
  workflowName: 'Expense review',
  versionNo: 1,
  status: 'queued',
  source: 'rest',
  payload: { amount: 42 },
  correlationId: CORRELATION_ID,
  submittedAt: '2026-08-24T00:00:00.000Z',
  statusChangedAt: '2026-08-24T00:00:00.000Z',
  attemptCount: 0,
  maxAttempts: 5,
};

function responseFixture(): {
  readonly headers: Map<string, string>;
  readonly response: Response;
  readonly statuses: number[];
} {
  const headers = new Map<string, string>();
  const statuses: number[] = [];
  return {
    headers,
    statuses,
    response: {
      setHeader: (name: string, value: string | number | readonly string[]) => {
        headers.set(name, String(value));
      },
      status: (status: number) => {
        statuses.push(status);
      },
    } as unknown as Response,
  };
}

describe('AuditController query contract', () => {
  it.each(INVALID_AUDIT_QUERIES)(
    'rejects malformed audit query %# before reading events',
    async (query, message) => {
      const audit = jest.fn();
      const controller = new AuditController({ audit } as unknown as OperationsService);

      await expect(controller.list(TENANT_CONTEXT, query)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        message,
      });
      expect(audit).not.toHaveBeenCalled();
    },
  );

  it('applies a validated event-type prefix before pagination and reports filtered totals', async () => {
    const events: JsonObject[] = [{ id: '1', eventType: 'auth.login_succeeded' }];
    const audit = jest.fn().mockResolvedValue({
      items: events,
      page: 1,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
    });
    const controller = new AuditController({ audit } as unknown as OperationsService);

    await expect(
      controller.list(TENANT_CONTEXT, { eventType: ' auth.login', page: '1', pageSize: '1' }),
    ).resolves.toEqual({
      items: [{ id: '1', eventType: 'auth.login_succeeded' }],
      meta: { page: 1, pageSize: 1, totalItems: 2, totalPages: 2 },
    });
    expect(audit).toHaveBeenCalledWith(TENANT_CONTEXT, 1, 1, 'auth.login');
  });
});

describe('RequestController submission semantics', () => {
  it('requires a strong idempotency key before invoking the application service', async () => {
    const submit = jest.fn();
    const controller = new RequestController(
      { submit } as unknown as RequestService,
      {} as OperationsService,
    );
    const response = responseFixture();

    await expect(
      controller.submit(
        TENANT_CONTEXT,
        { workflowKey: 'expense_review', payload: { amount: 42 } },
        'short',
        CORRELATION_ID,
        response.response,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('returns the stored status and explicit replay header for a durable replay', async () => {
    const submit = jest.fn().mockResolvedValue({
      statusCode: 201,
      replayed: true,
      body: { request: requestView },
    });
    const controller = new RequestController(
      { submit } as unknown as RequestService,
      {} as OperationsService,
    );
    const response = responseFixture();

    await expect(
      controller.submit(
        TENANT_CONTEXT,
        { workflowKey: 'expense_review', payload: { amount: 42 } },
        'request-key-1234',
        CORRELATION_ID,
        response.response,
      ),
    ).resolves.toBe(requestView);
    expect(response.statuses).toEqual([201]);
    expect(response.headers.get('Idempotency-Replayed')).toBe('true');
  });

  it('preserves 422 and validation details while marking the idempotency result', async () => {
    const validationErrors = [{ path: '/amount', message: 'must be positive' }];
    const submit = jest.fn().mockResolvedValue({
      statusCode: 422,
      replayed: false,
      body: { validationErrors },
    });
    const controller = new RequestController(
      { submit } as unknown as RequestService,
      {} as OperationsService,
    );
    const response = responseFixture();

    let thrown: unknown;
    try {
      await controller.submit(
        TENANT_CONTEXT,
        { workflowKey: 'expense_review', payload: { amount: -1 } },
        'request-key-1234',
        CORRELATION_ID,
        response.response,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UnprocessableEntityException);
    if (!(thrown instanceof UnprocessableEntityException)) {
      throw new Error('Expected UnprocessableEntityException');
    }
    expect(thrown.getStatus()).toBe(422);
    expect(thrown.getResponse()).toEqual({
      message: 'Workflow payload validation failed',
      details: { validationErrors },
    });
    expect(response.statuses).toEqual([422]);
    expect(response.headers.get('Idempotency-Replayed')).toBe('false');
  });

  it('rejects an invalid persisted response rather than returning an unsafe cast', async () => {
    const submit = jest.fn().mockResolvedValue({
      statusCode: 201,
      replayed: false,
      body: { request: null },
    });
    const controller = new RequestController(
      { submit } as unknown as RequestService,
      {} as OperationsService,
    );

    await expect(
      controller.submit(
        TENANT_CONTEXT,
        { workflowKey: 'expense_review', payload: {} },
        'request-key-1234',
        CORRELATION_ID,
        responseFixture().response,
      ),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});

describe('WebhookController secret provisioning', () => {
  it('returns the one-time signing secret envelope from the application service', async () => {
    const created = {
      endpoint: {
        active: true,
        id: '50000000-0000-4000-8000-000000000001',
        keyId: 'local-v1',
        name: 'Receiver',
        updatedAt: '2026-08-24T00:00:00.000Z',
        url: 'http://127.0.0.1:3300/webhooks',
      },
      replayed: false,
      signingSecret: 'one-time-signing-secret',
    };
    const createEndpoint = jest.fn().mockResolvedValue(created);
    const controller = new WebhookController(
      {} as OperationsService,
      { createEndpoint } as unknown as WebhookService,
    );

    await expect(
      controller.createEndpoint(
        TENANT_CONTEXT,
        { keyId: 'local-v1', name: 'Receiver', url: 'http://127.0.0.1:3300/webhooks' },
        'webhook-key-1234',
        CORRELATION_ID,
      ),
    ).resolves.toBe(created);
  });
});
