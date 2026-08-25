import { createHash, randomUUID } from 'node:crypto';

import type { TenantContext } from '../../packages/contracts/src/index.js';
import {
  OperationsStore,
  OutboxStore,
  RequestExecutionStore,
} from '../../packages/persistence/src/index.js';
import {
  cleanupTenant,
  createOwnerDataSource,
  createRuntimeDataSource,
  insertTenant,
  insertWorkflow,
  type TestDataSource,
} from './database-test-helpers.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function operatorContext(tenantId: string): TenantContext {
  return {
    principalId: randomUUID(),
    principalKind: 'user',
    role: 'operator',
    sessionId: randomUUID(),
    tenantId,
  };
}

describe('manual request retry attempt budgets', () => {
  let runtime: TestDataSource;
  let owner: TestDataSource;
  const tenantIds = new Set<string>();

  beforeAll(async () => {
    runtime = createRuntimeDataSource('queueforge-qa-manual-retry-runtime');
    owner = createOwnerDataSource('queueforge-qa-manual-retry-owner');
    await Promise.all([runtime.initialize(), owner.initialize()]);
  });

  afterEach(async () => {
    for (const tenantId of tenantIds) {
      await cleanupTenant(owner, tenantId);
    }
    tenantIds.clear();
  });

  afterAll(async () => {
    await Promise.all([
      runtime.isInitialized ? runtime.destroy() : Promise.resolve(),
      owner.isInitialized ? owner.destroy() : Promise.resolve(),
    ]);
  });

  it('retains monotonic attempt history while granting each manual retry a fresh bounded budget', async () => {
    const tenantId = randomUUID();
    tenantIds.add(tenantId);
    await insertTenant(runtime.manager, tenantId);
    const workflow = await insertWorkflow(runtime.manager, { tenantId });
    const requestId = randomUUID();
    const correlationId = randomUUID();
    await runtime.query(
      `INSERT INTO workflow_requests
         (tenant_id, id, workflow_template_id, workflow_version_id, status, source,
          payload, payload_hash, correlation_id, submitted_by_principal_id,
          submitted_by_principal_kind, attempt_count, attempt_sequence, max_attempts,
          submitted_at, status_changed_at)
       VALUES ($1, $2, $3, $4, 'queued', 'system', '{}'::jsonb, $5, $6, $7,
               'system', 0, 0, 2, clock_timestamp(), clock_timestamp())`,
      [
        tenantId,
        requestId,
        workflow.templateId,
        workflow.versionId,
        sha256('{}'),
        correlationId,
        randomUUID(),
      ],
    );

    const executions = new RequestExecutionStore(runtime);
    const operations = new OperationsStore(runtime);
    const context = operatorContext(tenantId);
    const consumer = 'qa.manual-retry-consumer.v1';
    const firstEventId = randomUUID();
    const retryEventId = randomUUID();

    const failNextAttempt = async (
      eventId: string,
      expectedAttemptNo: number,
      expectedBudgetAttemptNo: number,
    ): Promise<'queued' | 'dead_lettered'> => {
      const attempt = await executions.beginOrRecoverAttempt(
        { tenantId },
        requestId,
        `qa-worker-${randomUUID()}`,
        new Date(0),
        { consumer, eventId },
      );
      if (!('attemptNo' in attempt)) {
        throw new Error(`Expected an executable attempt, received ${JSON.stringify(attempt)}`);
      }
      expect(attempt).toMatchObject({
        attemptNo: expectedAttemptNo,
        budgetAttemptNo: expectedBudgetAttemptNo,
      });
      const result = await executions.completeFailedOnce({ tenantId }, eventId, consumer, {
        attemptNo: attempt.attemptNo,
        correlationId: attempt.correlationId,
        errorCode: 'QA_INJECTED_FAILURE',
        errorMessage: 'Synthetic bounded retry failure',
        requestId,
        startedAt: attempt.startedAt,
        workerId: `qa-worker-${expectedAttemptNo}`,
      });
      if (result === 'duplicate') {
        throw new Error('Attempt completion was unexpectedly treated as a duplicate');
      }
      return result;
    };

    await expect(failNextAttempt(firstEventId, 1, 1)).resolves.toBe('queued');
    await expect(failNextAttempt(firstEventId, 2, 2)).resolves.toBe('dead_lettered');

    const initialDeadLetters = (await runtime.query(
      `SELECT id FROM dead_letters
       WHERE tenant_id = $1 AND resource_kind = 'request' AND resource_id = $2
         AND status = 'open'`,
      [tenantId, requestId],
    )) as unknown as Array<{ id: string }>;
    const initialDeadLetterId = initialDeadLetters[0]?.id;
    expect(initialDeadLetterId).toEqual(expect.any(String));
    if (initialDeadLetterId === undefined) {
      throw new Error('Expected the initial request dead letter');
    }

    await expect(
      operations.retryDeadLetter({ ...context, role: 'viewer' }, initialDeadLetterId, randomUUID()),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });

    const concurrentRetries = await Promise.allSettled([
      operations.retryDeadLetter(context, initialDeadLetterId, randomUUID()),
      operations.retryDeadLetter(context, initialDeadLetterId, randomUUID()),
    ]);
    expect(concurrentRetries.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejectedRetries = concurrentRetries.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejectedRetries).toHaveLength(1);
    expect(rejectedRetries[0]?.reason).toMatchObject({
      code: 'CONFLICT',
      message: 'Dead letter was already handled',
    });
    await expect(
      operations.retryDeadLetter(context, initialDeadLetterId, randomUUID()),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const afterManualRetry = (await runtime.query(
      `SELECT status, attempt_count, attempt_sequence
       FROM workflow_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, requestId],
    )) as unknown as Array<{
      attempt_count: number;
      attempt_sequence: number;
      status: string;
    }>;
    expect(afterManualRetry[0]).toEqual({
      attempt_count: 0,
      attempt_sequence: 2,
      status: 'queued',
    });

    await expect(failNextAttempt(retryEventId, 3, 1)).resolves.toBe('queued');
    await expect(failNextAttempt(retryEventId, 4, 2)).resolves.toBe('dead_lettered');

    const finalState = (await runtime.query(
      `SELECT request.status, request.attempt_count, request.attempt_sequence,
              (SELECT array_agg(attempt.attempt_no ORDER BY attempt.attempt_no)
               FROM request_attempts attempt
               WHERE attempt.tenant_id = request.tenant_id
                 AND attempt.request_id = request.id) AS attempt_numbers,
              (SELECT count(*)::integer FROM dead_letters dead
               WHERE dead.tenant_id = request.tenant_id
                 AND dead.resource_kind = 'request' AND dead.resource_id = request.id
                 AND dead.status = 'open') AS open_dead_letters,
              (SELECT count(*)::integer FROM dead_letters dead
               WHERE dead.tenant_id = request.tenant_id
                 AND dead.resource_kind = 'request' AND dead.resource_id = request.id
                 AND dead.status = 'requeued') AS requeued_dead_letters,
              (SELECT count(*)::integer FROM processed_events event
               WHERE event.tenant_id = request.tenant_id AND event.consumer = $3
                 AND event.event_id IN ($4, $5)) AS terminal_receipts
       FROM workflow_requests request
       WHERE request.tenant_id = $1 AND request.id = $2`,
      [tenantId, requestId, consumer, firstEventId, retryEventId],
    )) as unknown as Array<{
      attempt_count: number;
      attempt_numbers: number[];
      attempt_sequence: number;
      open_dead_letters: number;
      requeued_dead_letters: number;
      status: string;
      terminal_receipts: number;
    }>;
    expect(finalState[0]).toEqual({
      attempt_count: 2,
      attempt_numbers: [1, 2, 3, 4],
      attempt_sequence: 4,
      open_dead_letters: 1,
      requeued_dead_letters: 1,
      status: 'dead_lettered',
      terminal_receipts: 2,
    });
  });

  it('requeues a dead outbox event with a fresh budget and monotonic append-only history', async () => {
    const tenantId = randomUUID();
    tenantIds.add(tenantId);
    await insertTenant(runtime.manager, tenantId);
    const eventId = randomUUID();
    await runtime.query(
      `INSERT INTO outbox_events
         (tenant_id, id, event_type, aggregate_type, aggregate_id, correlation_id,
          schema_version, payload, status, attempt_count, attempt_sequence, max_attempts,
          available_at)
       VALUES ($1, $2, 'qa.manual-retry', 'qa_fixture', $3, $4, 1, '{}'::jsonb,
               'pending', 0, 0, 2, '-infinity'::timestamptz)`,
      [tenantId, eventId, randomUUID(), randomUUID()],
    );

    const outbox = new OutboxStore(runtime);
    const operations = new OperationsStore(runtime);
    const context = operatorContext(tenantId);

    const failNextPublish = async (
      expectedBudgetAttemptNo: number,
      expectedSequence: number,
    ): Promise<'retry' | 'dead'> => {
      const leaseOwner = `qa-dispatcher-${randomUUID()}`;
      const claimed = await outbox.claimBatch(leaseOwner, 30, 100);
      expect(claimed.find((event) => event.id === eventId)).toMatchObject({
        attemptCount: expectedBudgetAttemptNo,
        leaseOwner,
      });
      const sequenceRows = (await runtime.query(
        `SELECT attempt_sequence FROM outbox_events WHERE tenant_id = $1 AND id = $2`,
        [tenantId, eventId],
      )) as unknown as Array<{ attempt_sequence: number }>;
      expect(sequenceRows).toEqual([{ attempt_sequence: expectedSequence }]);
      const result = await outbox.markFailed(
        tenantId,
        eventId,
        leaseOwner,
        'Synthetic outbox delivery failure',
        new Date(0),
      );
      if (result === 'stale_lease') {
        throw new Error('Claimed outbox lease was unexpectedly stale');
      }
      return result;
    };

    await expect(failNextPublish(1, 1)).resolves.toBe('retry');
    await expect(failNextPublish(2, 2)).resolves.toBe('dead');

    const initialDeadLetters = (await runtime.query(
      `SELECT id FROM dead_letters
       WHERE tenant_id = $1 AND resource_kind = 'outbox' AND resource_id = $2
         AND status = 'open'`,
      [tenantId, eventId],
    )) as unknown as Array<{ id: string }>;
    const initialDeadLetterId = initialDeadLetters[0]?.id;
    expect(initialDeadLetterId).toEqual(expect.any(String));
    if (initialDeadLetterId === undefined) {
      throw new Error('Expected the initial outbox dead letter');
    }

    await expect(
      operations.retryDeadLetter(context, initialDeadLetterId, randomUUID()),
    ).resolves.toEqual({ resourceId: eventId, resourceKind: 'outbox' });
    await expect(
      operations.retryDeadLetter(context, initialDeadLetterId, randomUUID()),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const afterManualRetry = (await runtime.query(
      `SELECT status, attempt_count, attempt_sequence
       FROM outbox_events WHERE tenant_id = $1 AND id = $2`,
      [tenantId, eventId],
    )) as unknown as Array<{
      attempt_count: number;
      attempt_sequence: number;
      status: string;
    }>;
    expect(afterManualRetry[0]).toEqual({
      attempt_count: 0,
      attempt_sequence: 2,
      status: 'retry',
    });

    await expect(failNextPublish(1, 3)).resolves.toBe('retry');
    await expect(failNextPublish(2, 4)).resolves.toBe('dead');

    const finalState = (await runtime.query(
      `SELECT event.status, event.attempt_count, event.attempt_sequence,
              (SELECT array_agg(DISTINCT attempt.attempt_no ORDER BY attempt.attempt_no)
               FROM outbox_attempts attempt
               WHERE attempt.tenant_id = event.tenant_id
                 AND attempt.outbox_event_id = event.id) AS attempt_numbers,
              (SELECT count(*)::integer FROM outbox_attempts attempt
               WHERE attempt.tenant_id = event.tenant_id
                 AND attempt.outbox_event_id = event.id) AS history_rows,
              (SELECT count(*)::integer FROM dead_letters dead
               WHERE dead.tenant_id = event.tenant_id
                 AND dead.resource_kind = 'outbox' AND dead.resource_id = event.id
                 AND dead.status = 'open') AS open_dead_letters,
              (SELECT count(*)::integer FROM dead_letters dead
               WHERE dead.tenant_id = event.tenant_id
                 AND dead.resource_kind = 'outbox' AND dead.resource_id = event.id
                 AND dead.status = 'requeued') AS requeued_dead_letters
       FROM outbox_events event
       WHERE event.tenant_id = $1 AND event.id = $2`,
      [tenantId, eventId],
    )) as unknown as Array<{
      attempt_count: number;
      attempt_numbers: number[];
      attempt_sequence: number;
      history_rows: number;
      open_dead_letters: number;
      requeued_dead_letters: number;
      status: string;
    }>;
    expect(finalState[0]).toEqual({
      attempt_count: 2,
      attempt_numbers: [1, 2, 3, 4],
      attempt_sequence: 4,
      history_rows: 8,
      open_dead_letters: 1,
      requeued_dead_letters: 1,
      status: 'dead',
    });
  });
});
