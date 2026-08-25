import type { PlatformRole, TenantRole } from '@queueforge/contracts';

export const ALL_WORKSPACE_ROLES = [
  'viewer',
  'approver',
  'operator',
  'tenant_admin',
] as const satisfies readonly TenantRole[];

export const WORKSPACE_ROUTE_ROLES = {
  approvals: ['approver'],
  audit: ['tenant_admin'],
  notifications: ALL_WORKSPACE_ROLES,
  operations: ['operator', 'tenant_admin'],
  overview: ALL_WORKSPACE_ROLES,
  requestDetail: ALL_WORKSPACE_ROLES,
  requests: ['operator', 'viewer'],
  team: ['tenant_admin'],
  webhookActivity: ['operator', 'tenant_admin'],
  workflowEditor: ['tenant_admin', 'viewer'],
  workflows: ['tenant_admin', 'viewer'],
} as const satisfies Readonly<Record<string, readonly TenantRole[]>>;

export function effectiveWorkspaceRole(
  role: TenantRole,
  platformRole: PlatformRole | null,
): TenantRole {
  return platformRole === 'platform_admin' ? 'tenant_admin' : role;
}

export function hasWorkspaceRoleAccess(
  allowedRoles: readonly TenantRole[],
  role: TenantRole,
  platformRole: PlatformRole | null,
): boolean {
  return allowedRoles.includes(effectiveWorkspaceRole(role, platformRole));
}
