import { HttpStatus, Logger, UnprocessableEntityException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { GraphQLError } from 'graphql';

import { ApplicationError } from '@queueforge/application';
import { DomainError } from '@queueforge/domain';
import { PersistenceConflictError, PersistenceNotFoundError } from '@queueforge/persistence';

import { AllExceptionsFilter } from './all-exceptions.filter.js';
import type { GraphqlHttpContext, QueueForgeRequest } from './http-context.js';

const REQUEST_ID = '10000000-0000-4000-8000-000000000001';
const CORRELATION_ID = '20000000-0000-4000-8000-000000000001';

function httpHost(): {
  readonly bodies: unknown[];
  readonly host: ArgumentsHost;
  readonly statuses: number[];
} {
  const bodies: unknown[] = [];
  const statuses: number[] = [];
  const json = (body: unknown): void => {
    bodies.push(body);
  };
  const response = {
    status(code: number) {
      statuses.push(code);
      return { json };
    },
  };
  const request = { requestId: REQUEST_ID, correlationId: CORRELATION_ID } as QueueForgeRequest;
  return {
    bodies,
    statuses,
    host: {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost,
  };
}

function graphqlHost(): ArgumentsHost {
  const context: GraphqlHttpContext = {
    req: { requestId: REQUEST_ID, correlationId: CORRELATION_ID } as QueueForgeRequest,
    res: {} as GraphqlHttpContext['res'],
  };
  return {
    getArgByIndex: () => context,
    getType: () => 'graphql',
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  it.each([
    [
      new ApplicationError('CSRF_VALIDATION_FAILED', 'CSRF failed'),
      HttpStatus.FORBIDDEN,
      'CSRF_VALIDATION_FAILED',
    ],
    [new PersistenceNotFoundError('workflow'), HttpStatus.NOT_FOUND, 'NOT_FOUND'],
    [
      new PersistenceConflictError('STALE_REVISION', 'Draft changed'),
      HttpStatus.CONFLICT,
      'STALE_REVISION',
    ],
    [
      new PersistenceConflictError('DATABASE_CONFLICT', 'Conflict'),
      HttpStatus.CONFLICT,
      'CONFLICT',
    ],
    [
      new DomainError('INVALID_STATE_TRANSITION', 'Cannot cancel a completed request', {
        current: 'succeeded',
        next: 'cancelled',
      }),
      HttpStatus.CONFLICT,
      'INVALID_STATE_TRANSITION',
    ],
    [
      new DomainError('PAYLOAD_SCHEMA_INVALID', 'Payload schema is invalid'),
      HttpStatus.BAD_REQUEST,
      'VALIDATION_FAILED',
    ],
  ] as const)('maps domain exception %# to the stable HTTP envelope', (exception, status, code) => {
    const fixture = httpHost();
    new AllExceptionsFilter().catch(exception, fixture.host);

    expect(fixture.statuses).toEqual([status]);
    expect(fixture.bodies).toEqual([
      expect.objectContaining({
        correlationId: CORRELATION_ID,
        requestId: REQUEST_ID,
        timestamp: expect.any(String),
        error: expect.objectContaining({ code }),
      }),
    ]);
  });

  it('preserves REST 422 semantics and serializable validation details', () => {
    const fixture = httpHost();
    new AllExceptionsFilter().catch(
      new UnprocessableEntityException({
        message: 'Workflow payload validation failed',
        details: { validationErrors: [{ path: '/amount', message: 'Required' }] },
      }),
      fixture.host,
    );

    expect(fixture.statuses).toEqual([HttpStatus.UNPROCESSABLE_ENTITY]);
    expect(fixture.bodies).toEqual([
      expect.objectContaining({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Workflow payload validation failed',
          details: { validationErrors: [{ path: '/amount', message: 'Required' }] },
        },
      }),
    ]);
  });

  it('redacts unexpected server errors while retaining request identifiers', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const fixture = httpHost();
    new AllExceptionsFilter().catch(new Error('database password leaked'), fixture.host);

    expect(fixture.statuses).toEqual([HttpStatus.INTERNAL_SERVER_ERROR]);
    expect(fixture.bodies).toEqual([
      expect.objectContaining({
        requestId: REQUEST_ID,
        correlationId: CORRELATION_ID,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      }),
    ]);
    expect(JSON.stringify(fixture.bodies)).not.toContain('database password leaked');
  });

  it.each([
    [
      Object.assign(new SyntaxError('Unexpected token'), {
        status: 400,
        type: 'entity.parse.failed',
      }),
      HttpStatus.BAD_REQUEST,
      'VALIDATION_FAILED',
    ],
    [
      Object.assign(new Error('request entity too large'), {
        status: 413,
        type: 'entity.too.large',
      }),
      HttpStatus.PAYLOAD_TOO_LARGE,
      'PAYLOAD_TOO_LARGE',
    ],
  ] as const)('maps trusted Express parser failure %# to a public 4xx', (error, status, code) => {
    const fixture = httpHost();
    new AllExceptionsFilter().catch(error, fixture.host);

    expect(fixture.statuses).toEqual([status]);
    expect(fixture.bodies).toEqual([
      expect.objectContaining({ error: expect.objectContaining({ code }) }),
    ]);
  });

  it('emits GraphQL error extensions without leaking an HTTP-shaped response', () => {
    let thrown: unknown;
    try {
      new AllExceptionsFilter().catch(
        new ApplicationError('AUTHORIZATION_DENIED', 'Not allowed'),
        graphqlHost(),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphQLError);
    if (!(thrown instanceof GraphQLError)) {
      throw new Error('Expected GraphQLError');
    }
    expect(thrown.extensions).toEqual({
      code: 'AUTHORIZATION_DENIED',
      correlationId: CORRELATION_ID,
      requestId: REQUEST_ID,
    });
  });

  it('maps state-machine failures to the same bounded GraphQL code and safe details', () => {
    let thrown: unknown;
    try {
      new AllExceptionsFilter().catch(
        new DomainError('INVALID_STATE_TRANSITION', 'Cannot retry request', {
          current: 'succeeded',
          next: 'queued',
        }),
        graphqlHost(),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphQLError);
    if (!(thrown instanceof GraphQLError)) {
      throw new Error('Expected GraphQLError');
    }
    expect(thrown.extensions).toEqual({
      code: 'INVALID_STATE_TRANSITION',
      correlationId: CORRELATION_ID,
      details: { current: 'succeeded', next: 'queued' },
      requestId: REQUEST_ID,
    });
  });
});
