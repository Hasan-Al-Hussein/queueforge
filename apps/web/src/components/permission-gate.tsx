'use client';

import type { ReactNode } from 'react';

import { StatePanel } from '@queueforge/ui';

import { useAuth, type Permission } from '../providers/auth-provider';

export function PermissionGate({
  children,
  permission,
  fallback = null,
}: {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
  readonly permission: Permission;
}): React.JSX.Element {
  const { can } = useAuth();
  return <>{can(permission) ? children : fallback}</>;
}

export function PermissionSurface({
  children,
  permission,
}: {
  readonly children: ReactNode;
  readonly permission: Permission;
}): React.JSX.Element {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <StatePanel
        description="Your current tenant role cannot use this surface. Ask a tenant administrator for access if your responsibilities changed."
        kind="forbidden"
        title="Permission required"
      />
    );
  }
  return <>{children}</>;
}
