import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthSession } from '@queueforge/contracts';

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
const selectTenantMock = vi.fn(async (): Promise<void> => undefined);

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
    replace: vi.fn(),
  });
  vi.mocked(useAuth).mockReturnValue({
    bootstrapError: null,
    can: vi.fn(() => true),
    login: vi.fn(),
    logout: logoutMock,
    online: true,
    selectTenant: selectTenantMock,
    session,
    status: 'authenticated',
  });
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

    const tenantSwitcher = screen.getByLabelText('Tenant');
    expect(tenantSwitcher.closest('.qf-shell__workspace')).toHaveAttribute('inert');
    expect(document.querySelector('.qf-sidebar--desktop')).toHaveAttribute('inert');

    const first = within(drawer).getByRole('link', { name: 'QueueForge overview' });
    const last = within(drawer).getByRole('link', { name: 'Team & access' });
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
    expect(screen.getByLabelText('Tenant').closest('.qf-shell__workspace')).not.toHaveAttribute(
      'inert',
    );
    expect(document.querySelector('.qf-sidebar--desktop')).not.toHaveAttribute('inert');
  });
});

describe('AppShell dirty exits', () => {
  it.each([
    ['brand', 'QueueForge overview', '/'],
    ['sidebar', 'Overview', '/'],
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

    await user.selectOptions(screen.getByRole('combobox', { name: 'Tenant' }), secondTenantId);
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
