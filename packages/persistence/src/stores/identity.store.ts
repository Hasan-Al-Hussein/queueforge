import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type {
  AuthSession,
  JsonObject,
  Membership,
  PlatformRole,
  TenantRole,
} from '@queueforge/contracts';

import { PersistenceConflictError, PersistenceNotFoundError } from '../errors.js';
import { queryRows } from '../query-result.js';
import { withSerializableRetry } from '../transaction-retry.js';

const REFRESH_REPLAY_GRACE_MS = 10_000;

export interface LoginUserRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly platformRole: PlatformRole | null;
  readonly isActive: boolean;
}

interface LoginUserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  platform_role: PlatformRole | null;
  is_active: boolean;
}

interface MembershipRow {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  role: TenantRole;
}

export interface CreateRefreshSessionInput {
  readonly familyId: string;
  readonly tokenId: string;
  readonly userId: string;
  readonly selectedTenantId: string;
  readonly csrfHash: string;
  readonly tokenHash: string;
  readonly familyExpiresAt: Date;
  readonly tokenExpiresAt: Date;
  readonly userAgentHash: string | null;
  readonly sourceIp: string | null;
  readonly audit: AuthEventInput;
}

export interface RefreshSessionRecord {
  readonly familyId: string;
  readonly tokenId: string;
}

export interface RotateRefreshInput {
  readonly tokenId: string;
  readonly verifyTokenHash: (storedHash: string) => Promise<boolean>;
  readonly verifyCsrfHash: (storedHash: string) => boolean;
  readonly nextTokenHash: string;
  readonly nextTokenExpiresAt: Date;
  readonly audit: {
    readonly correlationId: string;
    readonly sourceIp: string | null;
    readonly userAgentHash: string | null;
  };
  readonly issueSession: (input: {
    readonly familyId: string;
    readonly memberships: readonly Membership[];
    readonly selected: Membership;
    readonly user: Omit<LoginUserRecord, 'passwordHash'>;
  }) => Promise<AuthSession>;
}

export type RotateRefreshResult =
  | {
      readonly outcome: 'rotated';
      readonly familyId: string;
      readonly tokenId: string;
      readonly session: AuthSession;
      readonly replayed: boolean;
    }
  | { readonly outcome: 'invalid' }
  | { readonly outcome: 'csrf_invalid' }
  | {
      readonly outcome: 'reuse';
      readonly familyId: string;
      readonly userId: string;
      readonly tenantId: string;
    };

export interface ActiveAccessSession {
  readonly user: Omit<LoginUserRecord, 'passwordHash'>;
  readonly membership: Membership;
}

export interface AuthEventInput {
  readonly userId: string | null;
  readonly tenantId?: string;
  readonly eventType: string;
  readonly correlationId: string;
  readonly sourceIp: string | null;
  readonly metadata?: JsonObject;
}

export interface TenantSelectionAuditInput {
  readonly correlationId: string;
  readonly previousTenantId: string;
  readonly sourceIp: string | null;
}

async function insertAuthEvent(manager: EntityManager, input: AuthEventInput): Promise<void> {
  await manager.query(
    `INSERT INTO security_events
       (id, user_id, event_type, principal_kind, correlation_id, source_ip, safe_metadata)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.userId,
      input.eventType,
      input.userId !== null ? 'user' : null,
      input.correlationId,
      input.sourceIp,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  if (input.tenantId !== undefined) {
    await manager.query(
      `INSERT INTO audit_events
         (tenant_id, id, event_type, actor_principal_id, actor_principal_kind,
          resource_type, resource_id, correlation_id, safe_metadata)
       VALUES ($1, gen_random_uuid(), $2, $3, $4, 'auth_session', NULL, $5, $6::jsonb)`,
      [
        input.tenantId,
        input.eventType,
        input.userId,
        input.userId !== null ? 'user' : 'system',
        input.correlationId,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }
}

function mapMembershipRows(rows: readonly MembershipRow[]): readonly Membership[] {
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantSlug: row.tenant_slug,
    role: row.role,
  }));
}

@Injectable()
export class IdentityStore {
  public constructor(private readonly dataSource: DataSource) {}

  public async findUserForLogin(email: string): Promise<LoginUserRecord | null> {
    const rows = (await this.dataSource.query(
      `SELECT id, email, display_name, password_hash, platform_role, is_active
       FROM users WHERE lower(email) = lower($1) LIMIT 1`,
      [email],
    )) as unknown as LoginUserRow[];
    const row = rows[0];
    return row !== undefined
      ? {
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          passwordHash: row.password_hash,
          platformRole: row.platform_role,
          isActive: row.is_active,
        }
      : null;
  }

  public async findUserById(userId: string): Promise<Omit<LoginUserRecord, 'passwordHash'> | null> {
    const rows = (await this.dataSource.query(
      `SELECT id, email, display_name, platform_role, is_active
       FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    )) as unknown as Array<Omit<LoginUserRow, 'password_hash'>>;
    const row = rows[0];
    return row !== undefined
      ? {
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          platformRole: row.platform_role,
          isActive: row.is_active,
        }
      : null;
  }

  public async getFamilyCsrfHash(familyId: string, userId: string): Promise<string | null> {
    const rows = (await this.dataSource.query(
      `SELECT csrf_hash FROM refresh_token_families
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
         AND expires_at > clock_timestamp()`,
      [familyId, userId],
    )) as unknown as Array<{ csrf_hash: string }>;
    return rows[0]?.csrf_hash ?? null;
  }

  public async validateAccessSession(
    familyId: string,
    userId: string,
    tenantId: string,
  ): Promise<ActiveAccessSession | null> {
    const rows = (await this.dataSource.query(
      `SELECT app_user.id, app_user.email, app_user.display_name, app_user.platform_role,
              app_user.is_active, membership.role, tenant.name AS tenant_name,
              tenant.slug AS tenant_slug
       FROM refresh_token_families family
       JOIN users app_user ON app_user.id = family.user_id
       JOIN memberships membership
         ON membership.tenant_id = family.selected_tenant_id
        AND membership.user_id = family.user_id
       JOIN tenants tenant ON tenant.id = family.selected_tenant_id
       WHERE family.id = $1 AND family.user_id = $2 AND family.selected_tenant_id = $3
         AND family.revoked_at IS NULL AND family.expires_at > clock_timestamp()
         AND app_user.is_active AND membership.is_active AND tenant.is_active
       LIMIT 1`,
      [familyId, userId, tenantId],
    )) as unknown as Array<{
      id: string;
      email: string;
      display_name: string;
      platform_role: PlatformRole | null;
      is_active: boolean;
      role: TenantRole;
      tenant_name: string;
      tenant_slug: string;
    }>;
    const row = rows[0];
    return row !== undefined
      ? {
          user: {
            id: row.id,
            email: row.email,
            displayName: row.display_name,
            platformRole: row.platform_role,
            isActive: row.is_active,
          },
          membership: {
            tenantId,
            tenantName: row.tenant_name,
            tenantSlug: row.tenant_slug,
            role: row.role,
          },
        }
      : null;
  }

  public async recordAuthEvent(input: AuthEventInput): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await insertAuthEvent(manager, input);
    });
  }

  public async listMemberships(userId: string): Promise<readonly Membership[]> {
    const rows = (await this.dataSource.query(
      `SELECT membership.tenant_id, tenant.name AS tenant_name, tenant.slug AS tenant_slug,
              membership.role
       FROM memberships membership
       JOIN tenants tenant ON tenant.id = membership.tenant_id
       WHERE membership.user_id = $1 AND membership.is_active AND tenant.is_active
       ORDER BY tenant.name, tenant.id`,
      [userId],
    )) as unknown as MembershipRow[];
    return mapMembershipRows(rows);
  }

  public async createRefreshSession(
    input: CreateRefreshSessionInput,
  ): Promise<RefreshSessionRecord> {
    return this.dataSource.transaction(async (manager) => {
      const membership = (await manager.query(
        `SELECT 1 FROM memberships
         WHERE tenant_id = $1 AND user_id = $2 AND is_active
         FOR SHARE`,
        [input.selectedTenantId, input.userId],
      )) as unknown as Array<{ '?column?': number }>;
      if (membership.length === 0) {
        throw new PersistenceNotFoundError('active tenant membership');
      }
      await manager.query(
        `INSERT INTO refresh_token_families
           (id, user_id, selected_tenant_id, csrf_hash, user_agent_hash, created_ip, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.familyId,
          input.userId,
          input.selectedTenantId,
          input.csrfHash,
          input.userAgentHash,
          input.sourceIp,
          input.familyExpiresAt,
        ],
      );
      await manager.query(
        `INSERT INTO refresh_tokens (id, family_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [input.tokenId, input.familyId, input.tokenHash, input.tokenExpiresAt],
      );
      await insertAuthEvent(manager, input.audit);
      return { familyId: input.familyId, tokenId: input.tokenId };
    });
  }

  public async rotateRefresh(input: RotateRefreshInput): Promise<RotateRefreshResult> {
    return withSerializableRetry(this.dataSource, async (manager) => {
      const rows = (await manager.query(
        `SELECT token.id, token.family_id, token.token_hash, token.expires_at AS token_expires_at,
                token.consumed_at, token.revoked_at AS token_revoked_at,
                family.user_id, family.selected_tenant_id, family.csrf_hash,
                family.expires_at AS family_expires_at,
                family.revoked_at AS family_revoked_at,
                family.user_agent_hash, host(family.created_ip) AS created_ip,
                app_user.email, app_user.display_name, app_user.platform_role, app_user.is_active,
                membership.role, membership.is_active AS membership_active,
                tenant.name AS tenant_name, tenant.slug AS tenant_slug, tenant.is_active AS tenant_active
         FROM refresh_tokens token
         JOIN refresh_token_families family ON family.id = token.family_id
         JOIN users app_user ON app_user.id = family.user_id
         JOIN memberships membership
           ON membership.tenant_id = family.selected_tenant_id AND membership.user_id = family.user_id
         JOIN tenants tenant ON tenant.id = family.selected_tenant_id
         WHERE token.id = $1
         FOR UPDATE OF token, family`,
        [input.tokenId],
      )) as unknown as Array<{
        id: string;
        family_id: string;
        token_hash: string;
        token_expires_at: Date;
        consumed_at: Date | null;
        token_revoked_at: Date | null;
        user_id: string;
        selected_tenant_id: string;
        csrf_hash: string;
        family_expires_at: Date;
        family_revoked_at: Date | null;
        user_agent_hash: string | null;
        created_ip: string | null;
        email: string;
        display_name: string;
        platform_role: PlatformRole | null;
        is_active: boolean;
        role: TenantRole;
        membership_active: boolean;
        tenant_name: string;
        tenant_slug: string;
        tenant_active: boolean;
      }>;
      const row = rows[0];
      if (row === undefined || !(await input.verifyTokenHash(row.token_hash))) {
        await insertAuthEvent(manager, {
          userId: null,
          eventType: 'auth.refresh_failed',
          correlationId: input.audit.correlationId,
          sourceIp: input.audit.sourceIp,
          metadata: { reason: 'invalid_session' },
        });
        return { outcome: 'invalid' };
      }
      if (!input.verifyCsrfHash(row.csrf_hash)) {
        await insertAuthEvent(manager, {
          userId: row.user_id,
          tenantId: row.selected_tenant_id,
          eventType: 'auth.csrf_failed',
          correlationId: input.audit.correlationId,
          sourceIp: input.audit.sourceIp,
          metadata: { operation: 'refresh' },
        });
        return { outcome: 'csrf_invalid' };
      }
      const now = new Date();
      const issueCurrentSession = async (): Promise<AuthSession | null> => {
        const membershipRows = (await manager.query(
          `SELECT membership.tenant_id, tenant.name AS tenant_name, tenant.slug AS tenant_slug,
                  membership.role
           FROM memberships membership
           JOIN tenants tenant ON tenant.id = membership.tenant_id
           WHERE membership.user_id = $1 AND membership.is_active AND tenant.is_active
           ORDER BY tenant.name, tenant.id`,
          [row.user_id],
        )) as unknown as MembershipRow[];
        const memberships = mapMembershipRows(membershipRows);
        const selected = memberships.find(
          (membership) => membership.tenantId === row.selected_tenant_id,
        );
        if (selected === undefined) {
          return null;
        }
        return input.issueSession({
          familyId: row.family_id,
          memberships,
          selected,
          user: {
            id: row.user_id,
            email: row.email,
            displayName: row.display_name,
            platformRole: row.platform_role,
            isActive: row.is_active,
          },
        });
      };
      if (row.consumed_at !== null || row.token_revoked_at !== null) {
        const withinGrace =
          row.consumed_at !== null &&
          now.getTime() - row.consumed_at.getTime() >= 0 &&
          now.getTime() - row.consumed_at.getTime() <= REFRESH_REPLAY_GRACE_MS;
        const sameClient =
          row.created_ip === input.audit.sourceIp &&
          row.user_agent_hash === input.audit.userAgentHash;
        if (
          row.token_revoked_at === null &&
          row.family_revoked_at === null &&
          row.token_expires_at > now &&
          row.family_expires_at > now &&
          row.is_active &&
          row.membership_active &&
          row.tenant_active &&
          withinGrace &&
          sameClient
        ) {
          const successors = queryRows<{ id: string }>(
            await manager.query(
              `SELECT id FROM refresh_tokens
               WHERE family_id = $1 AND parent_token_id = $2
                 AND revoked_at IS NULL AND expires_at > clock_timestamp()
               ORDER BY created_at DESC LIMIT 1`,
              [row.family_id, row.id],
            ),
          );
          const successor = successors[0];
          const session = successor === undefined ? null : await issueCurrentSession();
          if (successor !== undefined && session !== null) {
            await insertAuthEvent(manager, {
              userId: row.user_id,
              tenantId: row.selected_tenant_id,
              eventType: 'auth.refresh_rotated',
              correlationId: input.audit.correlationId,
              sourceIp: input.audit.sourceIp,
              metadata: { familyId: row.family_id, replayed: true },
            });
            return {
              outcome: 'rotated',
              familyId: row.family_id,
              tokenId: successor.id,
              session,
              replayed: true,
            };
          }
        }
        await manager.query(
          `UPDATE refresh_token_families
           SET revoked_at = COALESCE(revoked_at, clock_timestamp()), revoke_reason = 'token_reuse'
           WHERE id = $1`,
          [row.family_id],
        );
        await manager.query(
          `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, clock_timestamp())
           WHERE family_id = $1`,
          [row.family_id],
        );
        await insertAuthEvent(manager, {
          userId: row.user_id,
          tenantId: row.selected_tenant_id,
          eventType: 'auth.refresh_reuse_detected',
          correlationId: input.audit.correlationId,
          sourceIp: input.audit.sourceIp,
          metadata: { familyId: row.family_id },
        });
        return {
          outcome: 'reuse',
          familyId: row.family_id,
          userId: row.user_id,
          tenantId: row.selected_tenant_id,
        };
      }
      if (
        row.family_revoked_at !== null ||
        row.token_expires_at <= now ||
        row.family_expires_at <= now ||
        !row.is_active ||
        !row.membership_active ||
        !row.tenant_active
      ) {
        await insertAuthEvent(manager, {
          userId: row.user_id,
          tenantId: row.selected_tenant_id,
          eventType: 'auth.refresh_failed',
          correlationId: input.audit.correlationId,
          sourceIp: input.audit.sourceIp,
          metadata: { reason: 'invalid_session' },
        });
        return { outcome: 'invalid' };
      }
      const session = await issueCurrentSession();
      if (session === null) {
        await insertAuthEvent(manager, {
          userId: row.user_id,
          tenantId: row.selected_tenant_id,
          eventType: 'auth.refresh_failed',
          correlationId: input.audit.correlationId,
          sourceIp: input.audit.sourceIp,
          metadata: { reason: 'membership_unavailable' },
        });
        return { outcome: 'invalid' };
      }
      const nextTokenId = randomUUID();
      await manager.query(
        `UPDATE refresh_tokens SET consumed_at = clock_timestamp() WHERE id = $1`,
        [row.id],
      );
      await manager.query(
        `INSERT INTO refresh_tokens (id, family_id, token_hash, parent_token_id, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [nextTokenId, row.family_id, input.nextTokenHash, row.id, input.nextTokenExpiresAt],
      );
      await insertAuthEvent(manager, {
        userId: row.user_id,
        tenantId: row.selected_tenant_id,
        eventType: 'auth.refresh_rotated',
        correlationId: input.audit.correlationId,
        sourceIp: input.audit.sourceIp,
        metadata: { familyId: row.family_id },
      });
      return {
        outcome: 'rotated',
        familyId: row.family_id,
        tokenId: nextTokenId,
        session,
        replayed: false,
      };
    });
  }

  public async selectTenant(
    familyId: string,
    userId: string,
    tenantId: string,
    audit: TenantSelectionAuditInput,
  ): Promise<Membership> {
    return this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `SELECT membership.role, tenant.name AS tenant_name, tenant.slug AS tenant_slug
         FROM memberships membership
         JOIN tenants tenant ON tenant.id = membership.tenant_id
         WHERE membership.tenant_id = $1 AND membership.user_id = $2
           AND membership.is_active AND tenant.is_active
         FOR SHARE OF membership, tenant`,
        [tenantId, userId],
      )) as unknown as Array<{ role: TenantRole; tenant_name: string; tenant_slug: string }>;
      const row = rows[0];
      if (row === undefined) {
        throw new PersistenceNotFoundError('active tenant membership');
      }
      const updated = queryRows<{ id: string }>(
        await manager.query(
          `UPDATE refresh_token_families SET selected_tenant_id = $3
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > clock_timestamp()
         RETURNING id`,
          [familyId, userId, tenantId],
        ),
      );
      if (updated.length === 0) {
        throw new PersistenceConflictError(
          'SESSION_REVOKED',
          'Refresh session is no longer active',
        );
      }
      await insertAuthEvent(manager, {
        userId,
        tenantId,
        eventType: 'auth.tenant_selected',
        correlationId: audit.correlationId,
        sourceIp: audit.sourceIp,
        metadata: { previousTenantId: audit.previousTenantId, sessionId: familyId },
      });
      return { tenantId, tenantName: row.tenant_name, tenantSlug: row.tenant_slug, role: row.role };
    });
  }

  public async revokeFamily(
    familyId: string,
    userId: string,
    reason: string,
    audit: AuthEventInput,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const rows = queryRows<{ id: string }>(
        await manager.query(
          `UPDATE refresh_token_families
         SET revoked_at = COALESCE(revoked_at, clock_timestamp()), revoke_reason = left($3, 200)
         WHERE id = $1 AND user_id = $2 RETURNING id`,
          [familyId, userId, reason],
        ),
      );
      if (rows.length === 0) {
        return false;
      }
      await manager.query(
        `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, clock_timestamp())
         WHERE family_id = $1`,
        [familyId],
      );
      await insertAuthEvent(manager, audit);
      return true;
    });
  }

  public async revokeAllFamilies(userId: string, reason: string): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const families = queryRows<{ id: string }>(
        await manager.query(
          `UPDATE refresh_token_families
         SET revoked_at = COALESCE(revoked_at, clock_timestamp()), revoke_reason = left($2, 200)
         WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`,
          [userId, reason],
        ),
      );
      if (families.length > 0) {
        await manager.query(
          `UPDATE refresh_tokens token SET revoked_at = COALESCE(token.revoked_at, clock_timestamp())
           FROM refresh_token_families family
           WHERE token.family_id = family.id AND family.user_id = $1`,
          [userId],
        );
      }
      return families.length;
    });
  }
}
