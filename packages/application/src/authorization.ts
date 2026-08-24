import type { TenantContext, TenantRole } from '@queueforge/contracts';

import { ApplicationError } from './errors.js';

export function requireAnyRole(
  context: TenantContext,
  allowed: readonly (TenantRole | 'platform_admin')[],
): void {
  if (!allowed.includes(context.role)) {
    throw new ApplicationError('AUTHORIZATION_DENIED', 'This action is not permitted');
  }
}
