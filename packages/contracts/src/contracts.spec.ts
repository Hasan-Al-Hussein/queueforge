import {
  ErrorEnvelopeSchema,
  DraftAutosaveInputSchema,
  EventEnvelopeSchema,
  MAX_PAGE_SIZE,
  PageQuerySchema,
  RequestListQuerySchema,
  SubmitWorkflowRequestSchema,
  TenantContextSchema,
} from './index.js';

const id = '018f4f77-8df8-7f20-b735-e307671e9110';

describe('public contracts', () => {
  it('rejects an untrusted tenant context with extra fields', () => {
    expect(() =>
      TenantContextSchema.parse({
        tenantId: id,
        principalId: id,
        principalKind: 'user',
        role: 'viewer',
        elevated: true,
      }),
    ).toThrow();
  });

  it('accepts only bounded workflow request objects', () => {
    expect(
      SubmitWorkflowRequestSchema.parse({ workflowKey: 'expense_review', payload: { amount: 42 } }),
    ).toEqual({ workflowKey: 'expense_review', payload: { amount: 42 } });
    expect(() =>
      SubmitWorkflowRequestSchema.parse({ workflowKey: 'Expense Review', payload: {} }),
    ).toThrow();
  });

  it('bounds pagination', () => {
    expect(PageQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(() => PageQuerySchema.parse({ pageSize: MAX_PAGE_SIZE + 1 })).toThrow();
  });

  it('allows only bounded request-list search and allowlisted server sort fields', () => {
    expect(
      RequestListQuerySchema.parse({
        page: '2',
        pageSize: '50',
        search: 'expense',
        sortBy: 'workflowName',
        sortDirection: 'asc',
        status: 'queued',
      }),
    ).toEqual({
      page: 2,
      pageSize: 50,
      search: 'expense',
      sortBy: 'workflowName',
      sortDirection: 'asc',
      status: 'queued',
    });
    expect(() => RequestListQuerySchema.parse({ sortBy: 'submitted_at desc; --' })).toThrow();
    expect(() => RequestListQuerySchema.parse({ search: 'x'.repeat(161) })).toThrow();
  });

  it('requires stable event and correlation identifiers', () => {
    expect(
      EventEnvelopeSchema.parse({
        schemaVersion: 1,
        eventId: id,
        tenantId: id,
        eventType: 'request.queued',
        aggregateType: 'workflow_request',
        aggregateId: id,
        correlationId: id,
        occurredAt: '2026-08-24T08:00:00.000Z',
        payload: {},
      }).eventType,
    ).toBe('request.queued');
  });

  it('does not permit arbitrary error codes', () => {
    expect(() =>
      ErrorEnvelopeSchema.parse({
        error: { code: 'PASSWORD_HASH_LEAKED', message: 'no' },
        requestId: id,
        correlationId: id,
        timestamp: '2026-08-24T08:00:00.000Z',
      }),
    ).toThrow();
  });

  it('requires bounded workflow targets with unique execution positions', () => {
    const draft = {
      description: null,
      expectedRevision: 1,
      isEnabled: true,
      name: 'Expense approval',
      preventSelfApproval: true,
      processingConfig: { maxAttempts: 5 },
      requestSchema: { type: 'object' },
      requiresApproval: true,
      targets: [
        { config: { handler: 'demo' }, position: 0, targetKind: 'processor' },
        { config: { endpointId: id }, position: 1, targetKind: 'webhook' },
      ],
    };

    expect(DraftAutosaveInputSchema.parse(draft).targets).toHaveLength(2);
    expect(DraftAutosaveInputSchema.parse(draft).processingConfig).toEqual({
      durationMs: 250,
      failuresBeforeSuccess: 0,
      maxAttempts: 5,
    });
    expect(() =>
      DraftAutosaveInputSchema.parse({
        ...draft,
        targets: [draft.targets[0], { ...draft.targets[1], position: 0 }],
      }),
    ).toThrow();
    expect(() =>
      DraftAutosaveInputSchema.parse({
        ...draft,
        targets: [
          draft.targets[0],
          { config: { endpointId: 'not-a-uuid' }, position: 1, targetKind: 'webhook' },
        ],
      }),
    ).toThrow();
    expect(() =>
      DraftAutosaveInputSchema.parse({
        ...draft,
        targets: [
          draft.targets[0],
          {
            config: {
              recipientKind: 'role',
              recipientRef: 'platform_admin',
              title: 'Unsupported role',
            },
            position: 1,
            targetKind: 'notification',
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      DraftAutosaveInputSchema.parse({
        ...draft,
        processingConfig: { durationMs: 10_001, maxAttempts: 5 },
      }),
    ).toThrow();
  });
});
