import type { INestApplication } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type {
  OpenAPIObject,
  OperationObject,
  ReferenceObject,
  ResponseObject,
  SchemaObject,
} from '@nestjs/swagger';

import {
  AdminService,
  ApiClientService,
  ApprovalService,
  AuthService,
  InboundWebhookService,
  OperationsService,
  RequestService,
  RUNTIME_ENVIRONMENT,
  WebhookService,
  WorkflowService,
} from '@queueforge/application';
import { MetricsService } from '@queueforge/observability';

import { ApiClientController } from '../controllers/api-client.controller.js';
import { ApprovalController } from '../controllers/approval.controller.js';
import { AuthController, SessionController } from '../controllers/auth.controller.js';
import {
  AuditController,
  DashboardController,
  NotificationController,
  OperationsController,
} from '../controllers/operations.controller.js';
import { RequestController } from '../controllers/request.controller.js';
import { TeamController, TenantAdminController } from '../controllers/team.controller.js';
import { InboundWebhookController, WebhookController } from '../controllers/webhook.controller.js';
import { WorkflowController } from '../controllers/workflow.controller.js';
import { DependencyProbeService } from '../health/dependency-probe.service.js';
import { HealthController, MetricsController } from '../health/health.controller.js';
import { createQueueForgeOpenApiDocument } from './document.js';

const controllerClasses = [
  ApprovalController,
  ApiClientController,
  AuditController,
  AuthController,
  DashboardController,
  HealthController,
  InboundWebhookController,
  MetricsController,
  NotificationController,
  OperationsController,
  RequestController,
  SessionController,
  TeamController,
  TenantAdminController,
  WebhookController,
  WorkflowController,
];

const serviceClasses = [
  AdminService,
  ApiClientService,
  ApprovalService,
  AuthService,
  InboundWebhookService,
  OperationsService,
  RequestService,
  WebhookService,
  WorkflowService,
];

@Module({
  controllers: controllerClasses,
  providers: [
    ...serviceClasses.map((service) => ({ provide: service, useValue: {} })),
    { provide: DependencyProbeService, useValue: {} },
    { provide: MetricsService, useValue: {} },
    {
      provide: RUNTIME_ENVIRONMENT,
      useValue: {
        NODE_ENV: 'test',
        WEB_ORIGIN: 'http://127.0.0.1:3100',
        REFRESH_COOKIE_NAME: 'queueforge_refresh',
        CSRF_COOKIE_NAME: 'queueforge_csrf',
      },
    },
  ],
})
class OpenApiTestModule {}

const methods = ['get', 'post', 'patch', 'delete', 'put'] as const;

function operations(document: OpenAPIObject): Array<{
  readonly method: (typeof methods)[number];
  readonly operation: OperationObject;
  readonly path: string;
}> {
  return Object.entries(document.paths).flatMap(([path, pathItem]) =>
    methods.flatMap((method) => {
      const operation = pathItem[method];
      return operation === undefined ? [] : [{ method, operation, path }];
    }),
  );
}

function dereferenceResponse(response: ResponseObject | ReferenceObject): ResponseObject {
  if ('$ref' in response) {
    throw new Error(`Unexpected response reference: ${response.$ref}`);
  }
  return response;
}

function dereferenceSchema(
  document: OpenAPIObject,
  schema: SchemaObject | ReferenceObject | undefined,
): SchemaObject {
  if (schema === undefined) {
    throw new Error('Response schema is missing');
  }
  if ('$ref' in schema) {
    const name = schema.$ref.match(/^#\/components\/schemas\/(.+)$/u)?.[1];
    const resolved = name === undefined ? undefined : document.components?.schemas?.[name];
    if (resolved === undefined || '$ref' in resolved) {
      throw new Error(`Unresolvable schema reference: ${schema.$ref}`);
    }
    return resolved;
  }
  return schema;
}

describe('QueueForge OpenAPI contract', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    app = await NestFactory.create(OpenApiTestModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.init();
    document = createQueueForgeOpenApiDocument(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('describes every REST operation with a concrete success contract', () => {
    const describedOperations = operations(document);
    expect(describedOperations).toHaveLength(42);

    for (const { operation } of describedOperations) {
      const successEntries = Object.entries(operation.responses).filter(([status]) =>
        status.startsWith('2'),
      );
      expect(successEntries).not.toHaveLength(0);
      for (const [status, rawResponse] of successEntries) {
        expect(rawResponse).toBeDefined();
        const response = dereferenceResponse(rawResponse as ResponseObject | ReferenceObject);
        expect(response.description.trim()).not.toBe('');
        if (status !== '204') {
          const mediaTypes = Object.values(response.content ?? {});
          expect(mediaTypes).not.toHaveLength(0);
          for (const mediaType of mediaTypes) {
            const schema = dereferenceSchema(document, mediaType.schema);
            expect(
              schema.type !== undefined ||
                schema.allOf !== undefined ||
                schema.oneOf !== undefined ||
                schema.anyOf !== undefined,
            ).toBe(true);
          }
        }
      }
      expect(operation.summary).toBeTruthy();
    }
  });

  it('documents concrete JSON bodies for every operation that consumes JSON', () => {
    const expected = new Set([
      'POST /api/v1/api-clients',
      'POST /api/v1/approvals/{approvalId}/decide',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/tenant-select',
      'POST /api/v1/inbound/webhooks/{tenantSlug}/{endpointId}',
      'PATCH /api/v1/notifications/{notificationId}',
      'POST /api/v1/requests',
      'POST /api/v1/team/memberships',
      'PATCH /api/v1/team/memberships/{userId}',
      'POST /api/v1/tenants',
      'POST /api/v1/webhooks/endpoints',
      'PATCH /api/v1/webhooks/endpoints/{endpointId}',
      'POST /api/v1/workflows',
      'PATCH /api/v1/workflows/{workflowId}/draft',
    ]);

    for (const { method, operation, path } of operations(document)) {
      const key = `${method.toUpperCase()} ${path}`;
      if (!expected.has(key)) {
        continue;
      }
      expect(operation.requestBody).toBeDefined();
      if (operation.requestBody === undefined || '$ref' in operation.requestBody) {
        throw new Error(`${key} does not have an inline request body`);
      }
      const schema = dereferenceSchema(
        document,
        operation.requestBody.content['application/json']?.schema,
      );
      expect(schema.type !== undefined || schema.allOf !== undefined).toBe(true);
    }
  });

  it('uses one structured error envelope and complete security schemes', () => {
    expect(document.components?.securitySchemes).toEqual(
      expect.objectContaining({
        apiKey: expect.any(Object),
        bearer: expect.any(Object),
        metricsBearer: expect.any(Object),
        refreshCookie: expect.any(Object),
      }),
    );
    expect(document.components?.schemas?.ErrorEnvelope).toEqual(
      expect.objectContaining({
        type: 'object',
        required: expect.arrayContaining(['error', 'requestId', 'correlationId', 'timestamp']),
      }),
    );

    for (const { operation } of operations(document)) {
      const response = dereferenceResponse(
        operation.responses['500'] as ResponseObject | ReferenceObject,
      );
      const schema = dereferenceSchema(document, response.content?.['application/json']?.schema);
      expect(schema.required).toEqual(
        expect.arrayContaining(['error', 'requestId', 'correlationId', 'timestamp']),
      );
      const error = schema.properties?.error;
      expect(error).toBeDefined();
      expect(error !== undefined && !('$ref' in error) ? error.required : undefined).toEqual(
        expect.arrayContaining(['code', 'message']),
      );
    }

    expect(document.paths['/api/v1/auth/login']?.post?.security).toBeUndefined();
    expect(document.paths['/api/v1/auth/refresh']?.post?.security).toEqual([{ refreshCookie: [] }]);
    expect(
      document.paths['/api/v1/inbound/webhooks/{tenantSlug}/{endpointId}']?.post?.security,
    ).toBeUndefined();
    expect(document.paths['/api/v1/requests']?.get?.security).toEqual(
      expect.arrayContaining([{ bearer: [] }, { apiKey: [] }]),
    );
  });

  it('documents paging metadata and required idempotency headers', () => {
    const pagedPaths = [
      '/api/v1/approvals',
      '/api/v1/audit',
      '/api/v1/notifications',
      '/api/v1/operations/dead-letters',
      '/api/v1/requests',
      '/api/v1/team/memberships',
      '/api/v1/webhooks/deliveries',
    ];
    for (const path of pagedPaths) {
      const operation = document.paths[path]?.get;
      expect(operation).toBeDefined();
      const success = dereferenceResponse(
        operation?.responses['200'] as ResponseObject | ReferenceObject,
      );
      const schema = dereferenceSchema(document, success.content?.['application/json']?.schema);
      expect(schema.properties).toEqual(
        expect.objectContaining({ items: expect.any(Object), meta: expect.any(Object) }),
      );
      const queryNames = (operation?.parameters ?? [])
        .filter((parameter) => !('$ref' in parameter) && parameter.in === 'query')
        .map((parameter) => ('$ref' in parameter ? '' : parameter.name));
      expect(queryNames).toEqual(expect.arrayContaining(['page', 'pageSize']));
    }

    const idempotentOperations = [
      ['post', '/api/v1/api-clients'],
      ['post', '/api/v1/approvals/{approvalId}/decide'],
      ['post', '/api/v1/inbound/webhooks/{tenantSlug}/{endpointId}'],
      ['post', '/api/v1/requests'],
      ['post', '/api/v1/requests/{requestId}/cancel'],
      ['post', '/api/v1/requests/{requestId}/retry'],
      ['post', '/api/v1/team/memberships'],
      ['post', '/api/v1/tenants'],
      ['post', '/api/v1/webhooks/deliveries/{deliveryId}/replay'],
      ['post', '/api/v1/webhooks/endpoints'],
      ['post', '/api/v1/workflows'],
    ] as const;
    for (const [method, path] of idempotentOperations) {
      const operation = document.paths[path]?.[method];
      const header = operation?.parameters?.find(
        (parameter) =>
          !('$ref' in parameter) &&
          parameter.in === 'header' &&
          parameter.name.toLowerCase() === 'idempotency-key',
      );
      expect(header).toEqual(expect.objectContaining({ required: true }));
    }
  });
});
