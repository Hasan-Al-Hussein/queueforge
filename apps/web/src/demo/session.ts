import type { AuthSession, Membership, TenantRole } from '@queueforge/contracts';

export const SHOWCASE_ROLE_EMAILS: Readonly<Record<TenantRole, string>> = {
  approver: 'amina.approver@queueforge.test',
  operator: 'omar.operator@queueforge.test',
  tenant_admin: 'admin@queueforge.test',
  viewer: 'viewer@queueforge.test',
};

const ROLE_USERS: Readonly<
  Record<TenantRole, { readonly displayName: string; readonly id: string }>
> = {
  approver: {
    displayName: 'Amina Approver',
    id: '20000000-0000-4000-8000-000000000002',
  },
  operator: {
    displayName: 'Omar Operator',
    id: '20000000-0000-4000-8000-000000000003',
  },
  tenant_admin: {
    displayName: 'QueueForge Admin',
    id: '20000000-0000-4000-8000-000000000001',
  },
  viewer: {
    displayName: 'Riley Viewer',
    id: '20000000-0000-4000-8000-000000000004',
  },
};

const ROLE_TENANT_IDS: Readonly<Record<TenantRole, string>> = {
  tenant_admin: '10000000-0000-4000-8000-000000000001',
  operator: '10000000-0000-4000-8000-000000000002',
  approver: '10000000-0000-4000-8000-000000000003',
  viewer: '10000000-0000-4000-8000-000000000004',
};

const ROLE_ORDER: readonly TenantRole[] = ['tenant_admin', 'operator', 'approver', 'viewer'];

function membershipForRole(role: TenantRole): Membership {
  return {
    role,
    tenantId: ROLE_TENANT_IDS[role],
    tenantName: 'Foundry Demonstration',
    tenantSlug: `showcase-${role.replace('_', '-')}`,
  };
}

export function showcaseRoleFromEmail(email: string): TenantRole {
  const normalized = email.trim().toLowerCase();
  return ROLE_ORDER.find((role) => SHOWCASE_ROLE_EMAILS[role] === normalized) ?? 'tenant_admin';
}

export function showcaseSession(role: TenantRole): AuthSession {
  const selectedTenant = membershipForRole(role);
  const user = ROLE_USERS[role];
  return {
    accessToken: 'x',
    accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    csrfToken: 'showcase-no-csrf-token-000000000000',
    memberships: ROLE_ORDER.map(membershipForRole),
    selectedTenant,
    user: {
      displayName: user.displayName,
      email: SHOWCASE_ROLE_EMAILS[role],
      id: user.id,
      platformRole: null,
    },
  };
}

export function showcaseSessionForTenant(tenantId: string): AuthSession {
  const role = ROLE_ORDER.find((candidate) => ROLE_TENANT_IDS[candidate] === tenantId);
  if (role === undefined) throw new Error('Unknown showcase role.');
  return showcaseSession(role);
}
