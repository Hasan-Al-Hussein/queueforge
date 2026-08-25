import { randomUUID } from 'node:crypto';

import { cleanupAuthFixtures } from '../database-cleanup.js';
import {
  cleanupTenant,
  cleanupUser,
  createOwnerDataSource,
  insertTenant,
  type TestDataSource,
} from './database-test-helpers.js';

describe('E2E database cleanup', () => {
  let owner: TestDataSource;
  const tenantIds = new Set<string>();
  const userIds = new Set<string>();

  beforeAll(async () => {
    owner = createOwnerDataSource('queueforge-qa-e2e-cleanup');
    await owner.initialize();
  });

  afterEach(async () => {
    for (const tenantId of tenantIds) await cleanupTenant(owner, tenantId);
    for (const userId of userIds) await cleanupUser(owner, userId);
    tenantIds.clear();
    userIds.clear();
  });

  afterAll(async () => {
    if (owner.isInitialized) await owner.destroy();
  });

  it('removes background auth rotations by their captured refresh-family identity', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const familyId = randomUUID();
    const loginCorrelationId = randomUUID();
    const rotationCorrelationId = randomUUID();
    const unrelatedCorrelationId = randomUUID();
    tenantIds.add(tenantId);
    userIds.add(userId);
    await insertTenant(owner.manager, tenantId);
    await owner.query(
      `INSERT INTO users (id, email, display_name, password_hash)
       VALUES ($1, $2, 'E2E cleanup fixture', 'synthetic-test-hash')`,
      [userId, `e2e-cleanup-${userId}@example.test`],
    );
    await owner.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1, $2, 'operator')`,
      [tenantId, userId],
    );
    await owner.query(
      `INSERT INTO refresh_token_families
         (id, user_id, selected_tenant_id, csrf_hash, expires_at)
       VALUES ($1, $2, $3, 'synthetic-csrf-hash', clock_timestamp() + interval '1 hour')`,
      [familyId, userId, tenantId],
    );
    const loginSecurityId = randomUUID();
    const rotationSecurityId = randomUUID();
    const unrelatedSecurityId = randomUUID();
    await owner.query(
      `INSERT INTO security_events
         (id, user_id, event_type, principal_kind, correlation_id, safe_metadata)
       VALUES
         ($1, $2, 'auth.login_succeeded', 'user', $3, jsonb_build_object('sessionId', $4::text)),
         ($5, $2, 'auth.refresh_rotated', 'user', $6, jsonb_build_object('familyId', $4::text)),
         ($7, $2, 'auth.refresh_rotated', 'user', $8, jsonb_build_object('familyId', $9::text))`,
      [
        loginSecurityId,
        userId,
        loginCorrelationId,
        familyId,
        rotationSecurityId,
        rotationCorrelationId,
        unrelatedSecurityId,
        unrelatedCorrelationId,
        randomUUID(),
      ],
    );
    const loginAuditId = randomUUID();
    const rotationAuditId = randomUUID();
    const unrelatedAuditId = randomUUID();
    await owner.query(
      `INSERT INTO audit_events
         (tenant_id, id, event_type, actor_principal_id, actor_principal_kind,
          resource_type, correlation_id, safe_metadata)
       VALUES
         ($1, $2, 'auth.login_succeeded', $3, 'user', 'auth_session', $4,
          jsonb_build_object('sessionId', $5::text)),
         ($1, $6, 'auth.refresh_rotated', $3, 'user', 'auth_session', $7,
          jsonb_build_object('familyId', $5::text)),
         ($1, $8, 'auth.refresh_rotated', $3, 'user', 'auth_session', $9,
          jsonb_build_object('familyId', $10::text))`,
      [
        tenantId,
        loginAuditId,
        userId,
        loginCorrelationId,
        familyId,
        rotationAuditId,
        rotationCorrelationId,
        unrelatedAuditId,
        unrelatedCorrelationId,
        randomUUID(),
      ],
    );

    await expect(cleanupAuthFixtures(owner, [loginCorrelationId])).resolves.toEqual({
      auditEvents: 2,
      refreshFamilies: 1,
      securityEvents: 2,
    });
    const leftovers = (await owner.query(
      `SELECT
         (SELECT count(*)::integer FROM refresh_token_families WHERE id = $1) AS families,
         (SELECT count(*)::integer FROM security_events WHERE id = ANY($2::uuid[])) AS security,
         (SELECT count(*)::integer FROM audit_events WHERE tenant_id = $3 AND id = ANY($4::uuid[])) AS audit,
         (SELECT count(*)::integer FROM security_events WHERE id = $5) AS "unrelatedSecurity",
         (SELECT count(*)::integer FROM audit_events WHERE tenant_id = $3 AND id = $6) AS "unrelatedAudit"`,
      [
        familyId,
        [loginSecurityId, rotationSecurityId],
        tenantId,
        [loginAuditId, rotationAuditId],
        unrelatedSecurityId,
        unrelatedAuditId,
      ],
    )) as unknown as ReadonlyArray<{
      readonly audit: number;
      readonly families: number;
      readonly security: number;
      readonly unrelatedAudit: number;
      readonly unrelatedSecurity: number;
    }>;
    expect(leftovers[0]).toEqual({
      audit: 0,
      families: 0,
      security: 0,
      unrelatedAudit: 1,
      unrelatedSecurity: 1,
    });
  });
});
