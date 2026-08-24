import type { TenantContext } from '@queueforge/contracts';

export type TenantScope = Readonly<Pick<TenantContext, 'tenantId'>>;

export function requireTenantId(scope: TenantScope): string {
  if (scope.tenantId.length === 0) {
    throw new Error('Tenant context is required');
  }
  return scope.tenantId;
}
