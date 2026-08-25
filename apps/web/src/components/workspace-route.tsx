'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import type { TenantRole } from '@queueforge/contracts';
import { StatePanel } from '@queueforge/ui';

import { useAuth } from '../providers/auth-provider';
import { SessionRequired, SessionRestoring } from './app-shell';
import { hasWorkspaceRoleAccess } from './workspace-access';

export interface WorkspaceRouteProps {
  readonly allowedRoles: readonly TenantRole[];
  readonly children: ReactNode;
}

export function WorkspaceRoute({ allowedRoles, children }: WorkspaceRouteProps): React.JSX.Element {
  const { bootstrapError, session, status } = useAuth();
  const router = useRouter();
  const allowed =
    session !== null &&
    hasWorkspaceRoleAccess(allowedRoles, session.selectedTenant.role, session.user.platformRole);

  useEffect(() => {
    if (status !== 'authenticated' || session === null || allowed) return;
    router.replace('/');
  }, [allowed, router, session, status]);

  if (status === 'bootstrapping') return <SessionRestoring />;
  if (session === null) return <SessionRequired error={bootstrapError} />;

  if (!allowed) {
    return (
      <main className="qf-session-gate">
        <StatePanel
          description="This page belongs to a different role. Taking you back home."
          kind="loading"
          title="Opening the right workspace"
        />
      </main>
    );
  }

  return <>{children}</>;
}
