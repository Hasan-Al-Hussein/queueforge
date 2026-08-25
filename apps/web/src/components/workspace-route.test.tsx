import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthSession, TenantRole } from '@queueforge/contracts';

import { useRouter } from 'next/navigation';
import { useAuth } from '../providers/auth-provider';
import { WORKSPACE_ROUTE_ROLES } from './workspace-access';
import { WorkspaceRoute } from './workspace-route';

vi.mock('next/navigation', () => ({ useRouter: vi.fn() }));
vi.mock('../providers/auth-provider', () => ({ useAuth: vi.fn() }));
vi.mock('./app-shell', () => ({
  SessionRequired: () => <div>Session required</div>,
  SessionRestoring: () => <div>Restoring session</div>,
}));

const replaceMock = vi.fn();
const childRenderMock = vi.fn();
const session: AuthSession = {
  accessToken: 'access-token',
  accessTokenExpiresAt: '2026-08-24T01:00:00.000Z',
  csrfToken: 'c'.repeat(32),
  memberships: [
    {
      tenantId: '10000000-0000-4000-8000-000000000001',
      tenantName: 'Acme Operations',
      tenantSlug: 'acme',
      role: 'operator',
    },
  ],
  selectedTenant: {
    tenantId: '10000000-0000-4000-8000-000000000001',
    tenantName: 'Acme Operations',
    tenantSlug: 'acme',
    role: 'operator',
  },
  user: {
    id: '20000000-0000-4000-8000-000000000001',
    displayName: 'Omar Operator',
    email: 'operator@queueforge.local',
    platformRole: null,
  },
};

function sessionForRole(
  role: TenantRole,
  platformRole: 'platform_admin' | null = null,
): AuthSession {
  return {
    ...session,
    memberships: session.memberships.map((membership) => ({ ...membership, role })),
    selectedTenant: { ...session.selectedTenant, role },
    user: { ...session.user, platformRole },
  };
}

function authValue(
  nextSession: AuthSession | null,
  status: 'anonymous' | 'authenticated' | 'bootstrapping',
): ReturnType<typeof useAuth> {
  return {
    bootstrapError: null,
    can: vi.fn(() => false),
    login: vi.fn(),
    logout: vi.fn(),
    online: true,
    selectTenant: vi.fn(),
    session: nextSession,
    status,
  };
}

function ProtectedChild(): React.JSX.Element {
  childRenderMock();
  return <div>Protected child</div>;
}

function renderRoute(allowedRoles: readonly TenantRole[]): void {
  render(
    <WorkspaceRoute allowedRoles={allowedRoles}>
      <ProtectedChild />
    </WorkspaceRoute>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useRouter).mockReturnValue({
    back: vi.fn(),
    bfcacheId: 'test-route',
    forward: vi.fn(),
    prefetch: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
    replace: replaceMock,
  });
  vi.mocked(useAuth).mockReturnValue(authValue(session, 'authenticated'));
});

describe('WorkspaceRoute', () => {
  it('does not mount a protected screen while authentication is restoring', () => {
    vi.mocked(useAuth).mockReturnValue(authValue(null, 'bootstrapping'));
    renderRoute(WORKSPACE_ROUTE_ROLES.requests);

    expect(screen.getByText('Restoring session')).toBeVisible();
    expect(childRenderMock).not.toHaveBeenCalled();
  });

  it('does not mount a protected screen for an anonymous browser', () => {
    vi.mocked(useAuth).mockReturnValue(authValue(null, 'anonymous'));
    renderRoute(WORKSPACE_ROUTE_ROLES.requests);

    expect(screen.getByText('Session required')).toBeVisible();
    expect(childRenderMock).not.toHaveBeenCalled();
  });

  it('redirects an operator without ever mounting the approval screen', async () => {
    renderRoute(WORKSPACE_ROUTE_ROLES.approvals);

    expect(screen.getByText('Opening the right workspace')).toBeVisible();
    expect(childRenderMock).not.toHaveBeenCalled();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'));
  });

  it('mounts the screen for its intended role', () => {
    vi.mocked(useAuth).mockReturnValue(authValue(sessionForRole('approver'), 'authenticated'));
    renderRoute(WORKSPACE_ROUTE_ROLES.approvals);

    expect(screen.getByText('Protected child')).toBeVisible();
    expect(childRenderMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('allows a platform administrator into admin routes', () => {
    vi.mocked(useAuth).mockReturnValue(
      authValue(sessionForRole('viewer', 'platform_admin'), 'authenticated'),
    );
    renderRoute(WORKSPACE_ROUTE_ROLES.team);

    expect(screen.getByText('Protected child')).toBeVisible();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
