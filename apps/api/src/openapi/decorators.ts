import { applyDecorators, HttpStatus } from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  type SchemaObject,
} from '@nestjs/swagger';

import { INBOUND_WEBHOOK_HEADERS } from '@queueforge/contracts';

import { REQUEST_STATUSES } from './schemas.js';

const IDEMPOTENCY_KEY_PATTERN = '^[A-Za-z0-9._:-]{8,200}$';
const ERROR_ENVELOPE_REFERENCE = { $ref: '#/components/schemas/ErrorEnvelope' };

interface JsonResponseOptions {
  readonly description: string;
  readonly schema: SchemaObject;
  readonly status?: number;
}

function errorResponse(status: number, description: string): MethodDecorator {
  return ApiResponse({
    status,
    description,
    content: { 'application/json': { schema: ERROR_ENVELOPE_REFERENCE } },
  });
}

export function ApiQueueForgeJsonResponse(options: JsonResponseOptions): MethodDecorator {
  return applyDecorators(
    ApiResponse({
      status: options.status ?? HttpStatus.OK,
      description: options.description,
      content: { 'application/json': { schema: options.schema } },
    }),
    errorResponse(HttpStatus.BAD_REQUEST, 'The request, tenant context, or input is invalid.'),
    errorResponse(HttpStatus.UNAUTHORIZED, 'Authentication failed or is required.'),
    errorResponse(HttpStatus.FORBIDDEN, 'The principal is not allowed to perform this operation.'),
    errorResponse(HttpStatus.NOT_FOUND, 'The tenant-scoped resource was not found.'),
    errorResponse(HttpStatus.CONFLICT, 'The command conflicts with current state or idempotency.'),
    errorResponse(HttpStatus.PAYLOAD_TOO_LARGE, 'The request body exceeds the route limit.'),
    errorResponse(HttpStatus.TOO_MANY_REQUESTS, 'The request rate limit was exceeded.'),
    errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, 'The request could not be completed.'),
    errorResponse(HttpStatus.SERVICE_UNAVAILABLE, 'A required dependency is unavailable.'),
  );
}

export function ApiQueueForgeNoContentResponse(description: string): MethodDecorator {
  return applyDecorators(
    ApiResponse({ status: HttpStatus.NO_CONTENT, description }),
    errorResponse(HttpStatus.BAD_REQUEST, 'The request, tenant context, or input is invalid.'),
    errorResponse(HttpStatus.UNAUTHORIZED, 'Authentication failed or is required.'),
    errorResponse(HttpStatus.FORBIDDEN, 'The principal is not allowed to perform this operation.'),
    errorResponse(HttpStatus.TOO_MANY_REQUESTS, 'The request rate limit was exceeded.'),
    errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, 'The request could not be completed.'),
  );
}

export function ApiQueueForgeTextResponse(description: string): MethodDecorator {
  return applyDecorators(
    ApiResponse({
      status: HttpStatus.OK,
      description,
      content: { 'text/plain': { schema: { type: 'string' } } },
    }),
    errorResponse(HttpStatus.UNAUTHORIZED, 'A metrics bearer token is required in production.'),
    errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, 'Metrics could not be rendered.'),
  );
}

export function ApiJsonBody(schema: SchemaObject, description: string): MethodDecorator {
  return ApiBody({
    required: true,
    description,
    schema,
  });
}

export function ApiIdempotencyKey(): MethodDecorator {
  return ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Stable command key. Reusing it with the same payload replays the result; changing the payload returns a conflict.',
    schema: { type: 'string', minLength: 8, maxLength: 200, pattern: IDEMPOTENCY_KEY_PATTERN },
  });
}

export function ApiCsrfToken(): MethodDecorator {
  return ApiHeader({
    name: 'X-CSRF-Token',
    required: true,
    description: 'Must equal the readable CSRF cookie for this refresh-token family.',
    schema: { type: 'string', minLength: 32 },
  });
}

export function ApiTrustedOrigin(): MethodDecorator {
  return ApiHeader({
    name: 'Origin',
    required: true,
    description: 'Must exactly match the configured QueueForge web origin.',
    schema: { type: 'string', format: 'uri' },
  });
}

export function ApiPageParameters(): MethodDecorator {
  return applyDecorators(
    ApiQuery({
      name: 'page',
      required: false,
      description: 'One-based result page.',
      schema: { type: 'integer', minimum: 1, default: 1 },
    }),
    ApiQuery({
      name: 'pageSize',
      required: false,
      description: 'Maximum results returned per page.',
      schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    }),
  );
}

export function ApiRequestListParameters(): MethodDecorator {
  return applyDecorators(
    ApiPageParameters(),
    ApiQuery({
      name: 'status',
      required: false,
      schema: { type: 'string', enum: REQUEST_STATUSES },
    }),
    ApiQuery({
      name: 'search',
      required: false,
      description: 'Case-insensitive request ID, workflow, status, or source search.',
      schema: { type: 'string', maxLength: 160 },
    }),
    ApiQuery({
      name: 'sortBy',
      required: false,
      schema: {
        type: 'string',
        enum: ['submittedAt', 'workflowName', 'status', 'source', 'attemptCount'],
        default: 'submittedAt',
      },
    }),
    ApiQuery({
      name: 'sortDirection',
      required: false,
      schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
    }),
  );
}

export function ApiAuditParameters(): MethodDecorator {
  return applyDecorators(
    ApiPageParameters(),
    ApiQuery({
      name: 'eventType',
      required: false,
      description: 'Case-sensitive event-type prefix.',
      schema: { type: 'string', maxLength: 160, pattern: '^[a-z][a-z0-9_.-]{0,159}$' },
    }),
  );
}

export function ApiInboundWebhookContract(bodySchema: SchemaObject): MethodDecorator {
  return applyDecorators(
    ApiJsonBody(
      bodySchema,
      'Signed workflow request payload. The exact raw bytes are authenticated.',
    ),
    ApiHeader({
      name: INBOUND_WEBHOOK_HEADERS.eventId,
      required: true,
      schema: { type: 'string', format: 'uuid' },
    }),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      schema: { type: 'string', minLength: 8, maxLength: 200, pattern: IDEMPOTENCY_KEY_PATTERN },
    }),
    ApiHeader({
      name: INBOUND_WEBHOOK_HEADERS.keyId,
      required: true,
      schema: { type: 'string', minLength: 2, maxLength: 80 },
    }),
    ApiHeader({
      name: INBOUND_WEBHOOK_HEADERS.nonce,
      required: true,
      schema: { type: 'string', minLength: 16, maxLength: 200 },
    }),
    ApiHeader({
      name: INBOUND_WEBHOOK_HEADERS.signature,
      required: true,
      description: 'Lowercase hexadecimal HMAC-SHA256 signature of the canonical signed bytes.',
      schema: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    }),
    ApiHeader({
      name: INBOUND_WEBHOOK_HEADERS.timestamp,
      required: true,
      description: 'Unix timestamp in seconds within the configured clock-skew window.',
      schema: { type: 'string', pattern: '^[0-9]{10}$' },
    }),
  );
}

export function ApiQueueForgeApiKeyAlternative(): ClassDecorator {
  return ApiSecurity('apiKey');
}
