import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthSession, TenantRole } from '@queueforge/contracts';

import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../providers/auth-provider';
import {
  DirtyNavigationProvider,
  useDirtyNavigationSource,
} from '../providers/dirty-navigation-provider';
import { useTheme } from '../providers/theme-provider';
import { useToast } from '../providers/toast-provider';
import { AppShell } from './app-shell';

interface MockLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  readonly children?: ReactNode;
  readonly href: string | { readonly pathname?: string };
  readonly prefetch?: boolean;
}

vi.mock('next/link', () => ({
  default: ({ children, href, prefetch, ...props }: MockLinkProps) => {
    void prefetch;
    return (
      <a href={typeof href === 'string' ? href : (href.pathname ?? '#')} {...props}>
        {children}
      </a>
    );
  },
}));

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
}));

vi.mock('../providers/auth-provider', () => ({ useAuth: vi.fn() }));
vi.mock('../providers/theme-provider', () => ({ useTheme: vi.fn() }));
vi.mock('../providers/toast-provider', () => ({ useToast: vi.fn() }));

const tenantId = '10000000-0000-4000-8000-000000000001';
const secondTenantId = '10000000-0000-4000-8000-000000000002';
const session: AuthSession = {
  accessToken: 'access-token',
  accessTokenExpiresAt: '2026-08-24T01:00:00.000Z',
  csrfToken: 'c'.repeat(32),
  memberships: [
    { tenantId, tenantName: 'Acme Operations', tenantSlug: 'acme', role: 'tenant_admin' },
    {
      tenantId: secondTenantId,
      tenantName: 'Foundry Systems',
      tenantSlug: 'foundry',
      role: 'operator',
    },
  ],
  selectedTenant: {
    tenantId,
    tenantName: 'Acme Operations',
    tenantSlug: 'acme',
    role: 'tenant_admin',
  },
  user: {
    id: '20000000-0000-4000-8000-000000000001',
    displayName: 'Queue Admin',
    email: 'admin@queueforge.test',
    platformRole: null,
  },
};

const logoutMock = vi.fn(async (): Promise<void> => undefined);
const pushMock = vi.fn();
const replaceMock = vi.fn();
const selectTenantMock = vi.fn(async (): Promise<void> => undefined);

function sessionForRole(
  role: TenantRole,
  platformRole: 'platform_admin' | null = null,
): AuthSession {
  return {
    ...session,
    memberships: session.memberships.map((membership) =>
      membership.tenantId === tenantId ? { ...membership, role } : membership,
    ),
    selectedTenant: { ...session.selectedTenant, role },
    user: { ...session.user, platformRole },
  };
}

function authValue(nextSession: AuthSession = session): ReturnType<typeof useAuth> {
  return {
    bootstrapError: null,
    can: vi.fn(() => true),
    login: vi.fn(),
    logout: logoutMock,
    online: true,
    selectTenant: selectTenantMock,
    session: nextSession,
    status: 'authenticated',
  };
}

const dialogPrototype = HTMLDialogElement.prototype;
const originalShowModal = Object.getOwnPropertyDescriptor(dialogPrototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(dialogPrototype, 'close');

function restoreDialogMethod(
  name: 'close' | 'showModal',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(dialogPrototype, name);
    return;
  }
  Object.defineProperty(dialogPrototype, name, descriptor);
}

beforeAll(() => {
  Object.defineProperty(dialogPrototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement): void {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(dialogPrototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement): void {
      this.removeAttribute('open');
    },
  });
});

afterAll(() => {
  restoreDialogMethod('showModal', originalShowModal);
  restoreDialogMethod('close', originalClose);
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usePathname).mockReturnValue('/');
  vi.mocked(useRouter).mockReturnValue({
    back: vi.fn(),
    bfcacheId: 'test-route',
    forward: vi.fn(),
    prefetch: vi.fn(),
    push: pushMock,
    refresh: vi.fn(),
    replace: replaceMock,
  });
  vi.mocked(useAuth).mockReturnValue(authValue());
  vi.mocked(useTheme).mockReturnValue({ theme: 'light', toggleTheme: vi.fn() });
  vi.mocked(useToast).mockReturnValue({ notify: vi.fn() });
});

function DirtySource({ dirty }: { readonly dirty: boolean }): null {
  useDirtyNavigationSource(dirty);
  return null;
}

function renderShell(dirty = false): void {
  render(
    <DirtyNavigationProvider>
      <DirtySource dirty={dirty} />
      <AppShell>
        <button type="button">Workspace action</button>
      </AppShell>
    </DirtyNavigationProvider>,
  );
}

describe('AppShell mobile navigation', () => {
  it('removes the closed drawer from the accessibility tree and tab order', () => {
    renderShell();

    expect(
      screen.queryByRole('dialog', { name: 'Application navigation' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close navigation' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('moves focus into the drawer and traps forward and reverse tabbing', async () => {
    const user = userEvent.setup();
    renderShell();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });

    await user.click(trigger);

    const drawer = await screen.findByRole('dialog', { name: 'Application navigation' });
    const close = within(drawer).getByRole('button', { name: 'Close navigation' });
    await waitFor(() => expect(close).toHaveFocus());
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const tenantSwitcher = screen.getByLabelText('Workspace');
    expect(tenantSwitcher.closest('.qf-shell__workspace')).toHaveAttribute('inert');
    expect(document.querySelector('.qf-sidebar--desktop')).toHaveAttribute('inert');

    const first = within(drawer).getByRole('link', { name: 'QueueForge overview' });
    const last = within(drawer).getByRole('link', { name: 'Notifications' });
    last.focus();
    await user.tab();
    expect(first).toHaveFocus();
    expect(tenantSwitcher).not.toHaveFocus();

    first.focus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('closes on Escape, releases the background, and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderShell();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });

    await user.click(trigger);
    await screen.findByRole('dialog', { name: 'Application navigation' });
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Application navigation' }),
      ).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
    expect(screen.getByLabelText('Workspace').closest('.qf-shell__workspace')).not.toHaveAttribute(
      'inert',
    );
    expect(document.querySelector('.qf-sidebar--desktop')).not.toHaveAttribute('inert');
  });
});

describe('AppShell role workspaces', () => {
  it('gives administrators configuration and monitoring without daily request or approval pages', () => {
    renderShell();

    const sidebar = screen.getByLabelText('Application sidebar');
    expect(within(sidebar).getByText('Admin workspace')).toBeVisible();
    expect(within(sidebar).getByRole('link', { name: 'Request types' })).toBeVisible();
    expect(within(sidebar).getByRole('link', { name: 'Delivery connections' })).toBeVisible();
    expect(within(sidebar).getByRole('link', { name: 'Activity log' })).toBeVisible();
    expect(
      within(sidebar).queryByRole('link', { name: /track requests/i }),
    ).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: 'Approval inbox' })).not.toBeInTheDocument();
  });

  it('gives operators daily request and recovery tools without approval or admin configuration', () => {
    vi.mocked(useAuth).mockReturnValue(authValue(sessionForRole('operator')));
    renderShell();

    const sidebar = screen.getByLabelText('Application sidebar');
    expect(within(sidebar).getByText('Operations workspace')).toBeVisible();
    expect(within(sidebar).getByRole('link', { name: 'Start & track requests' })).toBeVisible();
    expect(within(sidebar).getByRole('link', { name: 'Processing issues' })).toBeVisible();
    expect(within(sidebar).getByRole('link', { name: 'Delivery activity' })).toBeVisible();
    expect(within(sidebar).queryByRole('link', { name: 'Approval inbox' })).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('link', { name: 'People & access' }),
    ).not.toBeInTheDocument();
  });

  it('gives approvers a focused decision workspace', () => {
    vi.mocked(useAuth).mockReturnValue(authValue(sessionForRole('approver')));
    renderShell();

    const sidebar = screen.getByLabelText('Application sidebar');
    expect(within(sidebar).getByText('Approval workspace')).toBeVisible();
    expect(within(sidebar).getByRole('link', { name: 'Approval inbox' })).toBeVisible();
    expect(within(sidebar).queryByRole('link', { name: /requests/i })).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('link', { name: 'Processing issues' }),
    ).not.toBeInTheDocument();
  });

  it('gives viewers an explicitly read-only workspace', () => {
    vi.mocked(useAuth).mockReturnValue(authValue(sessionForRole('viewer')));
    renderShell();

    const sidebar = screen.getByLabelText('Application sidebar');
    expect(within(sidebar).getByText('Read-only workspace')).toBeVisible();
    expect(within(sidebar).getByRole('link', { name: 'Request history' })).toBeVisible();
    expect(within(sidebar).queryByRole('link', { name: 'Approval inbox' })).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('link', { name: 'People & access' }),
    ).not.toBeInTheDocument();
  });

  it('redirects a role away from another role workspace', async () => {
    vi.mocked(usePathname).mockReturnValue('/approvals');
    vi.mocked(useAuth).mockReturnValue(authValue(sessionForRole('operator')));
    renderShell();

    expect(screen.getByText('Opening the right workspace')).toBeVisible();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'));
  });

  it('keeps shared request details available from approval and overview links', () => {
    vi.mocked(usePathname).mockReturnValue('/requests/detail');
    vi.mocked(useAuth).mockReturnValue(authValue(sessionForRole('approver')));
    renderShell();

    expect(screen.getByRole('button', { name: 'Workspace action' })).toBeVisible();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('uses the admin workspace for a platform administrator', () => {
    vi.mocked(useAuth).mockReturnValue(authValue(sessionForRole('viewer', 'platform_admin')));
    renderShell();

    expect(
      within(screen.getByLabelText('Application sidebar')).getByText('Admin workspace'),
    ).toBeVisible();
  });
});

describe('AppShell dirty exits', () => {
  it.each([
    ['brand', 'QueueForge overview', '/'],
    ['sidebar', 'Home', '/'],
    ['notifications', 'Open notifications', '/notifications'],
  ] as const)('guards the %s link while a draft is dirty', async (_, linkName, href) => {
    const user = userEvent.setup();
    renderShell(true);

    await user.click(screen.getByRole('link', { name: linkName }));
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Continue with unsaved changes?' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Discard changes and continue' }));
    expect(pushMock).toHaveBeenCalledWith(href);
  });

  it('guards tenant switching until the operator confirms', async () => {
    const user = userEvent.setup();
    renderShell(true);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Workspace' }), secondTenantId);
    expect(selectTenantMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard changes and continue' }));

    await waitFor(() => expect(selectTenantMock).toHaveBeenCalledWith(secondTenantId));
    expect(pushMock).toHaveBeenCalledWith('/');
  });

  it('guards sign out until the operator confirms', async () => {
    const user = userEvent.setup();
    renderShell(true);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logoutMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard changes and continue' }));
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
  });
});
