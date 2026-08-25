interface CleanupExecutor {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

interface CleanupDataSource {
  transaction<T>(operation: (manager: CleanupExecutor) => Promise<T>): Promise<T>;
}

export interface AuthFixtureCleanupResult {
  readonly auditEvents: number;
  readonly refreshFamilies: number;
  readonly securityEvents: number;
}

export interface WorkflowFixtureCleanupResult {
  readonly queueJobIds: readonly string[];
}

export interface WorkflowFixtureCleanupScope {
  readonly expectedTemplates?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly stableKey: string;
  }>;
  readonly requestIds: readonly string[];
  readonly stableKeys: readonly string[];
  readonly templateIds: readonly string[];
  readonly tenantCreation: {
    readonly id?: string;
    readonly slug: string;
  };
  readonly tenantId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const E2E_WORKFLOW_KEY = /^(?:recovery|exhausted)_[a-z0-9]+_[0-9a-f]{8}$/u;
const E2E_TENANT_SLUG = /^e2e-[a-z0-9]+-[0-9a-f]{8}$/u;

function assertWorkflowCleanupScope(scope: WorkflowFixtureCleanupScope): void {
  if (!UUID.test(scope.tenantId))
    throw new Error('Refusing workflow cleanup for an invalid tenant');
  if (
    scope.stableKeys.length === 0 ||
    scope.stableKeys.some((key) => !E2E_WORKFLOW_KEY.test(key))
  ) {
    throw new Error('Refusing workflow cleanup for a non-E2E stable key');
  }
  if (!E2E_TENANT_SLUG.test(scope.tenantCreation.slug)) {
    throw new Error('Refusing workflow cleanup for a non-E2E tenant slug');
  }
  if (
    scope.templateIds.some((id) => !UUID.test(id)) ||
    scope.requestIds.some((id) => !UUID.test(id)) ||
    (scope.tenantCreation.id !== undefined && !UUID.test(scope.tenantCreation.id))
  ) {
    throw new Error('Refusing workflow cleanup for an invalid captured identifier');
  }
  if (
    scope.expectedTemplates?.some(
      (template) =>
        !UUID.test(template.id) ||
        !E2E_WORKFLOW_KEY.test(template.stableKey) ||
        template.name.length === 0,
    ) === true
  ) {
    throw new Error('Refusing workflow cleanup for an invalid expected template identity');
  }
}

function assertCapturedIds(
  kind: string,
  captured: readonly string[],
  found: readonly string[],
): void {
  const foundIds = new Set(found);
  const missing = captured.find((id) => !foundIds.has(id));
  if (missing !== undefined) {
    throw new Error(
      `Refusing workflow cleanup because captured ${kind} ${missing} is out of scope`,
    );
  }
}

export async function cleanupWorkflowFixtures(
  ownerDataSource: CleanupDataSource,
  scope: WorkflowFixtureCleanupScope,
): Promise<WorkflowFixtureCleanupResult> {
  assertWorkflowCleanupScope(scope);
  const stableKeys = [...new Set(scope.stableKeys)];
  const templateIds = [...new Set(scope.templateIds)];
  const requestIds = [...new Set(scope.requestIds)];

  return ownerDataSource.transaction(async (manager) => {
    await manager.query(`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
    await manager.query(`SET LOCAL session_replication_role = 'replica'`);
    await manager.query(
      `CREATE TEMP TABLE qf_e2e_templates ON COMMIT DROP AS
       SELECT id
       FROM workflow_templates
       WHERE tenant_id = $1 AND stable_key = ANY($2::text[])`,
      [scope.tenantId, stableKeys],
    );
    await manager.query(
      `CREATE TEMP TABLE qf_e2e_versions ON COMMIT DROP AS
       SELECT id
       FROM workflow_versions
       WHERE tenant_id = $1 AND template_id IN (SELECT id FROM qf_e2e_templates)`,
      [scope.tenantId],
    );
    await manager.query(
      `CREATE TEMP TABLE qf_e2e_requests ON COMMIT DROP AS
       SELECT id, correlation_id
       FROM workflow_requests
       WHERE tenant_id = $1 AND workflow_template_id IN (SELECT id FROM qf_e2e_templates)`,
      [scope.tenantId],
    );

    const foundTemplates = (await manager.query(
      `SELECT template.id::text AS id, template.name, template.stable_key AS "stableKey"
       FROM workflow_templates template
       WHERE template.id IN (SELECT id FROM qf_e2e_templates)`,
    )) as unknown as ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly stableKey: string;
    }>;
    const foundRequests = (await manager.query(
      `SELECT id::text AS id FROM qf_e2e_requests`,
    )) as unknown as ReadonlyArray<{ readonly id: string }>;
    assertCapturedIds(
      'workflow template',
      templateIds,
      foundTemplates.map((row) => row.id),
    );
    assertCapturedIds(
      'request',
      requestIds,
      foundRequests.map((row) => row.id),
    );
    if (scope.expectedTemplates !== undefined) {
      const expected = new Map(
        scope.expectedTemplates.map((template) => [
          template.id,
          `${template.stableKey}\u0000${template.name}`,
        ]),
      );
      if (
        expected.size !== scope.expectedTemplates.length ||
        foundTemplates.length !== expected.size
      ) {
        throw new Error(
          `Refusing workflow cleanup because the exact template-count guard expected ${expected.size} but found ${foundTemplates.length}`,
        );
      }
      const mismatch = foundTemplates.find(
        (template) => expected.get(template.id) !== `${template.stableKey}\u0000${template.name}`,
      );
      if (mismatch !== undefined) {
        throw new Error(
          `Refusing workflow cleanup because template ${mismatch.id} no longer matches its expected key/name identity`,
        );
      }
    }

    await manager.query(
      `CREATE TEMP TABLE qf_e2e_approvals ON COMMIT DROP AS
       SELECT id
       FROM approval_tasks
       WHERE tenant_id = $1 AND request_id IN (SELECT id FROM qf_e2e_requests)`,
      [scope.tenantId],
    );
    await manager.query(
      `CREATE TEMP TABLE qf_e2e_notifications ON COMMIT DROP AS
       SELECT id
       FROM notifications
       WHERE tenant_id = $1 AND request_id IN (SELECT id FROM qf_e2e_requests)`,
      [scope.tenantId],
    );
    await manager.query(
      `CREATE TEMP TABLE qf_e2e_outbox ON COMMIT DROP AS
       SELECT id
       FROM outbox_events
       WHERE tenant_id = $1
         AND (
           correlation_id IN (SELECT correlation_id FROM qf_e2e_requests)
           OR aggregate_id IN (SELECT id FROM qf_e2e_requests)
           OR aggregate_id IN (SELECT id FROM qf_e2e_approvals)
           OR aggregate_id IN (SELECT id FROM qf_e2e_notifications)
           OR payload ->> 'requestId' IN (SELECT id::text FROM qf_e2e_requests)
           OR payload ->> 'approvalId' IN (SELECT id::text FROM qf_e2e_approvals)
         )`,
      [scope.tenantId],
    );
    await manager.query(
      `CREATE TEMP TABLE qf_e2e_deliveries ON COMMIT DROP AS
       SELECT id, event_id
       FROM webhook_deliveries
       WHERE tenant_id = $1
         AND (
           id::text IN (
             SELECT event.payload ->> 'deliveryId'
             FROM outbox_events event
             WHERE event.id IN (SELECT id FROM qf_e2e_outbox)
           )
           OR payload_snapshot #>> '{payload,requestId}' IN (
             SELECT id::text FROM qf_e2e_requests
           )
           OR payload_snapshot ->> 'correlationId' IN (
             SELECT correlation_id::text FROM qf_e2e_requests
           )
         )`,
      [scope.tenantId],
    );
    await manager.query(
      `CREATE TEMP TABLE qf_e2e_dead_letters ON COMMIT DROP AS
       SELECT id
       FROM dead_letters
       WHERE tenant_id = $1
         AND resource_id IN (
           SELECT id FROM qf_e2e_requests
           UNION SELECT id FROM qf_e2e_outbox
           UNION SELECT id FROM qf_e2e_deliveries
         )`,
      [scope.tenantId],
    );
    await manager.query(
      `CREATE TEMP TABLE qf_e2e_audit ON COMMIT DROP AS
       SELECT id
       FROM audit_events
       WHERE tenant_id = $1
         AND (
           correlation_id IN (SELECT correlation_id FROM qf_e2e_requests)
           OR resource_id IN (
             SELECT id FROM qf_e2e_templates
             UNION SELECT id FROM qf_e2e_versions
             UNION SELECT id FROM qf_e2e_requests
             UNION SELECT id FROM qf_e2e_approvals
             UNION SELECT id FROM qf_e2e_notifications
             UNION SELECT id FROM qf_e2e_outbox
             UNION SELECT id FROM qf_e2e_deliveries
             UNION SELECT id FROM qf_e2e_dead_letters
           )
         )`,
      [scope.tenantId],
    );
    await manager.query(
      `CREATE TEMP TABLE qf_e2e_idempotency ON COMMIT DROP AS
       SELECT id
       FROM idempotency_records
       WHERE tenant_id = $1
         AND (
           response_body ->> 'templateId' IN (SELECT id::text FROM qf_e2e_templates)
           OR response_body #>> '{request,id}' IN (SELECT id::text FROM qf_e2e_requests)
           OR response_body ->> 'requestId' IN (SELECT id::text FROM qf_e2e_requests)
           OR response_body ->> 'approvalId' IN (SELECT id::text FROM qf_e2e_approvals)
           OR response_body ->> 'tenantId' = $2
           OR response_body ->> 'slug' = $3
         )`,
      [scope.tenantId, scope.tenantCreation.id ?? '', scope.tenantCreation.slug],
    );
    const queueEvents = (await manager.query(
      `SELECT id::text AS id
       FROM qf_e2e_outbox
       ORDER BY id`,
    )) as unknown as ReadonlyArray<{ readonly id: string }>;

    await manager.query(
      `DELETE FROM webhook_delivery_attempts
       WHERE tenant_id = $1 AND delivery_id IN (SELECT id FROM qf_e2e_deliveries)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM webhook_deliveries
       WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_deliveries)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM outbox_attempts
       WHERE tenant_id = $1 AND outbox_event_id IN (SELECT id FROM qf_e2e_outbox)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM processed_events
       WHERE tenant_id = $1
         AND event_id IN (
           SELECT id FROM qf_e2e_outbox
           UNION SELECT event_id FROM qf_e2e_deliveries
         )`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM outbox_events
       WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_outbox)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM notification_deliveries
       WHERE tenant_id = $1 AND notification_id IN (SELECT id FROM qf_e2e_notifications)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM notification_reads
       WHERE tenant_id = $1 AND notification_id IN (SELECT id FROM qf_e2e_notifications)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM notifications
       WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_notifications)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM approval_decisions
       WHERE tenant_id = $1 AND request_id IN (SELECT id FROM qf_e2e_requests)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM approval_tasks
       WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_approvals)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM request_attempts
       WHERE tenant_id = $1 AND request_id IN (SELECT id FROM qf_e2e_requests)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM request_transitions
       WHERE tenant_id = $1 AND request_id IN (SELECT id FROM qf_e2e_requests)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM inbound_webhook_receipts
       WHERE tenant_id = $1 AND request_id IN (SELECT id FROM qf_e2e_requests)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM dead_letters
       WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_dead_letters)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM audit_events
       WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_audit)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM idempotency_records
       WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_idempotency)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM workflow_requests
       WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_requests)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM workflow_targets
       WHERE tenant_id = $1 AND workflow_version_id IN (SELECT id FROM qf_e2e_versions)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM workflow_versions
       WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_versions)`,
      [scope.tenantId],
    );
    await manager.query(
      `DELETE FROM workflow_templates
       WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_templates)`,
      [scope.tenantId],
    );

    const leftovers = (await manager.query(
      `SELECT
         (SELECT count(*)::integer FROM workflow_templates WHERE tenant_id = $1 AND stable_key = ANY($2::text[]))
         + (SELECT count(*)::integer FROM workflow_requests WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_requests))
         + (SELECT count(*)::integer FROM approval_tasks WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_approvals))
         + (SELECT count(*)::integer FROM notifications WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_notifications))
         + (SELECT count(*)::integer FROM outbox_events WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_outbox))
         + (SELECT count(*)::integer FROM webhook_deliveries WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_deliveries))
         + (SELECT count(*)::integer FROM audit_events WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_audit))
         + (SELECT count(*)::integer FROM idempotency_records WHERE tenant_id = $1 AND id IN (SELECT id FROM qf_e2e_idempotency))
         AS count`,
      [scope.tenantId, stableKeys],
    )) as unknown as ReadonlyArray<{ readonly count: number }>;
    if ((leftovers[0]?.count ?? 1) !== 0) {
      throw new Error('E2E workflow cleanup left dependent rows behind');
    }
    return { queueJobIds: queueEvents.map((event) => `qf-${event.id}`) };
  });
}

export async function cleanupAuthFixtures(
  ownerDataSource: CleanupDataSource,
  correlationIds: readonly string[],
): Promise<AuthFixtureCleanupResult> {
  const correlations = [...new Set(correlationIds)];
  if (correlations.length === 0 || correlations.some((id) => !UUID.test(id))) {
    throw new Error('Refusing auth cleanup for missing or invalid correlation IDs');
  }

  return ownerDataSource.transaction(async (manager) => {
    await manager.query(`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
    await manager.query(`SET LOCAL session_replication_role = 'replica'`);
    await manager.query(
      `CREATE TEMP TABLE qf_e2e_auth_seed_security ON COMMIT DROP AS
       SELECT id, safe_metadata
       FROM security_events
       WHERE correlation_id = ANY($1::uuid[]) AND event_type LIKE 'auth.%'`,
      [correlations],
    );
    await manager.query(
      `CREATE TEMP TABLE qf_e2e_refresh_families ON COMMIT DROP AS
       SELECT DISTINCT family.id
       FROM refresh_token_families family
       JOIN qf_e2e_auth_seed_security event
         ON family.id::text = COALESCE(event.safe_metadata ->> 'sessionId', event.safe_metadata ->> 'familyId')`,
    );
    await manager.query(
      `CREATE TEMP TABLE qf_e2e_security_events ON COMMIT DROP AS
       SELECT id
       FROM security_events
       WHERE event_type LIKE 'auth.%'
         AND (
           correlation_id = ANY($1::uuid[])
           OR COALESCE(safe_metadata ->> 'sessionId', safe_metadata ->> 'familyId') IN (
             SELECT id::text FROM qf_e2e_refresh_families
           )
         )`,
      [correlations],
    );
    await manager.query(
      `CREATE TEMP TABLE qf_e2e_auth_audit ON COMMIT DROP AS
       SELECT tenant_id, id
       FROM audit_events
       WHERE resource_type = 'auth_session'
         AND event_type LIKE 'auth.%'
         AND (
           correlation_id = ANY($1::uuid[])
           OR COALESCE(safe_metadata ->> 'sessionId', safe_metadata ->> 'familyId') IN (
             SELECT id::text FROM qf_e2e_refresh_families
           )
         )`,
      [correlations],
    );

    const counts = (await manager.query(
      `SELECT
         (SELECT count(*)::integer FROM qf_e2e_auth_audit) AS "auditEvents",
         (SELECT count(*)::integer FROM qf_e2e_refresh_families) AS "refreshFamilies",
         (SELECT count(*)::integer FROM qf_e2e_security_events) AS "securityEvents"`,
    )) as unknown as readonly AuthFixtureCleanupResult[];
    await manager.query(
      `DELETE FROM refresh_tokens
       WHERE family_id IN (SELECT id FROM qf_e2e_refresh_families)`,
    );
    await manager.query(
      `DELETE FROM refresh_token_families
       WHERE id IN (SELECT id FROM qf_e2e_refresh_families)`,
    );
    await manager.query(
      `DELETE FROM audit_events
       WHERE (tenant_id, id) IN (SELECT tenant_id, id FROM qf_e2e_auth_audit)`,
    );
    await manager.query(
      `DELETE FROM security_events
       WHERE id IN (SELECT id FROM qf_e2e_security_events)`,
    );
    const leftovers = (await manager.query(
      `SELECT
         (SELECT count(*)::integer
          FROM audit_events
          WHERE resource_type = 'auth_session'
            AND event_type LIKE 'auth.%'
            AND (
              correlation_id = ANY($1::uuid[])
              OR COALESCE(safe_metadata ->> 'sessionId', safe_metadata ->> 'familyId') IN (
                SELECT id::text FROM qf_e2e_refresh_families
              )
            ))
         +
         (SELECT count(*)::integer
          FROM security_events
          WHERE event_type LIKE 'auth.%'
            AND (
              correlation_id = ANY($1::uuid[])
              OR COALESCE(safe_metadata ->> 'sessionId', safe_metadata ->> 'familyId') IN (
                SELECT id::text FROM qf_e2e_refresh_families
              )
            )) AS count`,
      [correlations],
    )) as unknown as ReadonlyArray<{ readonly count: number }>;
    if ((leftovers[0]?.count ?? 1) !== 0) {
      throw new Error('E2E auth cleanup left correlated audit or security events behind');
    }
    return counts[0] ?? { auditEvents: 0, refreshFamilies: 0, securityEvents: 0 };
  });
}

export async function cleanupTenant(
  ownerDataSource: CleanupDataSource,
  tenantId: string,
): Promise<void> {
  await ownerDataSource.transaction(async (manager) => {
    await manager.query(`SET LOCAL session_replication_role = 'replica'`);
    const rows = (await manager.query(
      `SELECT DISTINCT table_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'tenant_id'
       ORDER BY table_name`,
    )) as unknown as Array<{ table_name: string }>;
    for (const row of rows) {
      if (!/^[a-z][a-z0-9_]*$/.test(row.table_name)) {
        throw new Error('Unsafe tenant table name returned by PostgreSQL metadata');
      }
      await manager.query(`DELETE FROM "${row.table_name}" WHERE tenant_id = $1`, [tenantId]);
    }
    await manager.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  });
}

export async function cleanupUser(
  ownerDataSource: CleanupDataSource,
  userId: string,
): Promise<void> {
  await ownerDataSource.transaction(async (manager) => {
    await manager.query(`SET LOCAL session_replication_role = 'replica'`);
    await manager.query(
      `DELETE FROM refresh_tokens
       WHERE family_id IN (SELECT id FROM refresh_token_families WHERE user_id = $1)`,
      [userId],
    );
    await manager.query(`DELETE FROM refresh_token_families WHERE user_id = $1`, [userId]);
    await manager.query(`DELETE FROM security_events WHERE user_id = $1`, [userId]);
    await manager.query(`DELETE FROM users WHERE id = $1`, [userId]);
  });
}
