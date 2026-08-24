import 'reflect-metadata';

import type { DynamicModule, Provider } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import type { ValidationRule } from 'graphql';
import { buildSchema, GraphQLError, parse, validate } from 'graphql';

import type {
  ApprovalService,
  OperationsService,
  RequestService,
  WorkflowService,
} from '@queueforge/application';
import type { JsonObject, TenantContext, WorkflowRequestView } from '@queueforge/contracts';

import type { QueueForgeRequest } from '../common/http-context.js';

jest.mock('@queueforge/config', () => ({
  loadRuntimeEnvironment: () => ({ NODE_ENV: 'production' }),
}));

import {
  assertGraphqlComplexity,
  enrichGraphqlError,
  GraphqlApiModule,
} from './graphql-api.module.js';
import { QueueForgeResolver } from './queueforge.resolver.js';

const TENANT_CONTEXT: TenantContext = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  principalId: '20000000-0000-4000-8000-000000000001',
  principalKind: 'user',
  role: 'operator',
  sessionId: '30000000-0000-4000-8000-000000000001',
};
const CORRELATION_ID = '40000000-0000-4000-8000-000000000001';

interface GraphqlOptionsShape {
  readonly csrfPrevention: boolean;
  readonly includeStacktraceInErrorResponses: boolean;
  readonly introspection: boolean;
  readonly validationRules: readonly ValidationRule[];
}

function graphqlOptions(): GraphqlOptionsShape {
  const imports = Reflect.getMetadata(
    MODULE_METADATA.IMPORTS,
    GraphqlApiModule,
  ) as unknown as readonly DynamicModule[];
  const graphqlImport = imports[0];
  if (graphqlImport === undefined || !Array.isArray(graphqlImport.providers)) {
    throw new Error('GraphQL dynamic module metadata is unavailable');
  }
  const provider = (graphqlImport.providers as Provider[]).find(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'provide' in candidate &&
      candidate.provide === 'GqlModuleOptions',
  );
  if (provider === undefined || typeof provider !== 'object' || !('useValue' in provider)) {
    throw new Error('GraphQL options provider is unavailable');
  }
  return provider.useValue as GraphqlOptionsShape;
}

function resolverWith(
  requests: Partial<RequestService>,
  approvals: Partial<ApprovalService> = {},
): QueueForgeResolver {
  return new QueueForgeResolver(
    requests as RequestService,
    {} as WorkflowService,
    approvals as ApprovalService,
    {} as OperationsService,
  );
}

describe('GraphQL hard limits', () => {
  const options = graphqlOptions();

  it('keeps CSRF protection, stack redaction, and production-style introspection controls configured', () => {
    expect(options.csrfPrevention).toBe(true);
    expect(options.includeStacktraceInErrorResponses).toBe(false);
    expect(options.introspection).toBe(false);
  });

  it('rejects more than 20 aliases', () => {
    const schema = buildSchema('type Query { value: String }');
    const selections = Array.from({ length: 21 }, (_, index) => `a${String(index)}: value`);
    const errors = validate(schema, parse(`{ ${selections.join(' ')} }`), [
      ...options.validationRules,
    ]);
    expect(errors.some((error) => error.message.includes('at most 20 aliases'))).toBe(true);
  });

  it('rejects operations deeper than the configured maximum', () => {
    const schema = buildSchema('type Node { child: Node value: String } type Query { node: Node }');
    const document = parse(
      `{ node { child { child { child { child { child { child { child { child { value } } } } } } } } } }`,
    );
    const errors = validate(schema, document, [...options.validationRules]);
    expect(errors.some((error) => /depth/iu.test(error.message))).toBe(true);
  });

  it('rejects operations above complexity 200', () => {
    const fields = Array.from({ length: 201 }, (_, index) => `f${String(index)}: String`);
    const selections = Array.from({ length: 201 }, (_, index) => `f${String(index)}`);
    const schema = buildSchema(`type Query { ${fields.join(' ')} }`);
    expect(() =>
      assertGraphqlComplexity({
        document: parse(`{ ${selections.join(' ')} }`),
        schema,
      }),
    ).toThrow(/complexity/iu);
  });

  it('evaluates complexity with the actual request variables', () => {
    const schema = buildSchema('type Query { value(id: ID!): String }');
    expect(() =>
      assertGraphqlComplexity({
        document: parse('query Probe($id: ID!) { value(id: $id) }'),
        operationName: 'Probe',
        schema,
        variables: { id: '50000000-0000-4000-8000-000000000001' },
      }),
    ).not.toThrow();
  });

  it('normalizes parse and validation errors with public codes and request correlation', () => {
    const error = new GraphQLError('Variable was not provided', {
      extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
    });
    enrichGraphqlError(error, {
      correlationId: CORRELATION_ID,
      requestId: '50000000-0000-4000-8000-000000000001',
    } as QueueForgeRequest);
    expect(error.extensions).toMatchObject({
      code: 'VALIDATION_FAILED',
      correlationId: CORRELATION_ID,
      requestId: '50000000-0000-4000-8000-000000000001',
    });
  });
});

describe('QueueForgeResolver transport semantics', () => {
  it.each([
    [0, 10, undefined],
    [1, 0, undefined],
    [1, 101, undefined],
    [1, 10, 'unknown-status'],
  ] as const)(
    'rejects invalid request list arguments before store access',
    async (page, pageSize, status) => {
      const list = jest.fn();
      const resolver = resolverWith({ list } as Partial<RequestService>);

      await expect(
        resolver.requestList(TENANT_CONTEXT, page, pageSize, status),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(list).not.toHaveBeenCalled();
    },
  );

  it('maps a durable 422 submission into GraphQL error details', async () => {
    const validationErrors: JsonObject[] = [{ path: '/amount', message: 'Required' }];
    const submit = jest.fn().mockResolvedValue({
      statusCode: 422,
      replayed: false,
      body: { validationErrors },
    });
    const resolver = resolverWith({ submit } as Partial<RequestService>);

    await expect(
      resolver.submit(
        TENANT_CONTEXT,
        'expense_review',
        { amount: null },
        'graphql-key-1234',
        CORRELATION_ID,
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { validationErrors },
    });
  });

  it('requires an idempotency key before GraphQL submission', async () => {
    const submit = jest.fn();
    const resolver = resolverWith({ submit } as Partial<RequestService>);

    await expect(
      resolver.submit(TENANT_CONTEXT, 'expense_review', {}, 'short', CORRELATION_ID),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('returns the validated request object from a successful submission', async () => {
    const request: WorkflowRequestView = {
      id: '50000000-0000-4000-8000-000000000001',
      workflowId: '60000000-0000-4000-8000-000000000001',
      workflowVersionId: '70000000-0000-4000-8000-000000000001',
      workflowName: 'Expense review',
      versionNo: 1,
      status: 'queued',
      source: 'graphql',
      payload: {},
      correlationId: CORRELATION_ID,
      submittedAt: '2026-08-24T00:00:00.000Z',
      statusChangedAt: '2026-08-24T00:00:00.000Z',
      attemptCount: 0,
      maxAttempts: 5,
    };
    const submit = jest.fn().mockResolvedValue({
      statusCode: 201,
      replayed: false,
      body: { request },
    });
    const resolver = resolverWith({ submit } as Partial<RequestService>);

    await expect(
      resolver.submit(TENANT_CONTEXT, 'expense_review', {}, 'graphql-key-1234', CORRELATION_ID),
    ).resolves.toBe(request);
  });

  it('rejects malformed request identifiers before store access', () => {
    const detail = jest.fn();
    const resolver = resolverWith({ detail } as Partial<RequestService>);

    expect(() => resolver.requestDetail(TENANT_CONTEXT, 'not-a-uuid')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
    expect(detail).not.toHaveBeenCalled();
  });

  it('applies the shared submission contract before service access', async () => {
    const submit = jest.fn();
    const resolver = resolverWith({ submit } as Partial<RequestService>);

    await expect(
      resolver.submit(TENANT_CONTEXT, 'INVALID KEY', {}, 'graphql-key-1234', CORRELATION_ID),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('applies UUID, revision, and note bounds to GraphQL approvals', () => {
    const decide = jest.fn();
    const resolver = resolverWith({}, { decide } as Partial<ApprovalService>);

    expect(() =>
      resolver.decideApproval(
        TENANT_CONTEXT,
        'not-a-uuid',
        'approved',
        0,
        'x'.repeat(2_001),
        'graphql-key-1234',
        CORRELATION_ID,
      ),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    expect(decide).not.toHaveBeenCalled();
  });
});
