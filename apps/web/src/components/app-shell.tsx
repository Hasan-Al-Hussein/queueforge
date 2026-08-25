'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  Bell,
  Boxes,
  ChevronDown,
  ClipboardCheck,
  FileClock,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  ShieldCheck,
  Sun,
  Users,
  Webhook,
  Workflow,
  X,
  Button,
  StatePanel,
  cn,
} from '@queueforge/ui';

import { useAuth } from '../providers/auth-provider';
import { useDirtyNavigation } from '../providers/dirty-navigation-provider';
import { useTheme } from '../providers/theme-provider';
import { useToast } from '../providers/toast-provider';
import { formatProblem } from '../api/client';

interface NavItem {
  readonly href: Route;
  readonly icon: ComponentType<{ readonly size?: string | number }>;
  readonly label: string;
}

interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Everyday work',
    items: [
      { href: '/', icon: LayoutDashboard, label: 'Home' },
      { href: '/requests', icon: Workflow, label: 'Requests' },
      { href: '/approvals', icon: ClipboardCheck, label: 'Approval inbox' },
    ],
  },
  {
    label: 'Set up',
    items: [
      { href: '/workflows', icon: GitBranch, label: 'Workflow builder' },
      { href: '/webhooks', icon: Webhook, label: 'Connections' },
    ],
  },
  {
    label: 'Monitor',
    items: [
      { href: '/operations', icon: Boxes, label: 'Processing health' },
      { href: '/notifications', icon: Bell, label: 'Notifications' },
      { href: '/audit', icon: FileClock, label: 'Activity history' },
    ],
  },
  {
    label: 'Organization',
    items: [{ href: '/team', icon: Users, label: 'People & access' }],
  },
];

const DRAWER_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getDrawerFocusableElements(drawer: HTMLDialogElement): HTMLElement[] {
  return Array.from(drawer.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR));
}

function isCurrentPath(pathname: string, href: Route): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand({
  onNavigate,
}: {
  readonly onNavigate?: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
}): React.JSX.Element {
  return (
    <Link
      aria-label="QueueForge overview"
      className="qf-brand"
      href="/"
      onClick={onNavigate}
      prefetch={false}
    >
      <span className="qf-brand__mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>
        <strong>QueueForge</strong>
        <small>workflow control</small>
      </span>
    </Link>
  );
}

function Navigation({
  onNavigate,
}: {
  readonly onNavigate: (event: ReactMouseEvent<HTMLAnchorElement>, href: Route) => void;
}): React.JSX.Element {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary navigation" className="qf-nav">
      {NAV_GROUPS.map((group) => (
        <div className="qf-nav__group" key={group.label}>
          <p className="qf-nav__label">{group.label}</p>
          <ul>
            {group.items.map((item) => {
              const Icon = item.icon;
              const current = isCurrentPath(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    aria-current={current ? 'page' : undefined}
                    href={item.href}
                    onClick={(event) => onNavigate(event, item.href)}
                    prefetch={false}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

interface SidebarContentProps {
  readonly online: boolean;
  readonly onClose?: () => void;
  readonly onNavigate: (event: ReactMouseEvent<HTMLAnchorElement>, href: Route) => void;
  readonly role: string;
  readonly tenantName: string;
}

function SidebarContent({
  online,
  onClose,
  onNavigate,
  role,
  tenantName,
}: SidebarContentProps): React.JSX.Element {
  return (
    <>
      <div className="qf-sidebar__brand-row">
        <Brand onNavigate={(event) => onNavigate(event, '/')} />
        {onClose !== undefined ? (
          <Button
            aria-label="Close navigation"
            className="qf-sidebar__close"
            data-mobile-navigation-close
            icon={<X size={19} />}
            onClick={onClose}
            tone="quiet"
          />
        ) : null}
      </div>
      <div className="qf-tenant-stamp">
        <span>Current workspace</span>
        <strong>{tenantName}</strong>
        <small>{role.replaceAll('_', ' ')}</small>
      </div>
      <Navigation onNavigate={onNavigate} />
      <div className="qf-sidebar__footer">
        <span
          className={cn(
            'qf-service-state',
            online ? 'qf-service-state--online' : 'qf-service-state--offline',
          )}
        >
          <Activity size={14} aria-hidden="true" />
          {online ? 'Browser online' : 'Browser offline'}
        </span>
        <span className="qf-utility">Local console · v0.1</span>
      </div>
    </>
  );
}

export function SessionRequired({ error }: { readonly error: string | null }): React.JSX.Element {
  return (
    <div className="qf-session-gate">
      <Brand />
      <StatePanel
        action={
          <Link className="qf-button qf-button--primary" href="/login" prefetch={false}>
            Sign in
          </Link>
        }
        description={error ?? 'Sign in to restore an in-memory access session for your tenant.'}
        kind={error === null ? 'forbidden' : 'error'}
        title="Session required"
      />
    </div>
  );
}

export function SessionRestoring(): React.JSX.Element {
  return (
    <div className="qf-session-gate">
      <Brand />
      <StatePanel
        description="Checking the local refresh session. Authentication material is never restored from browser storage."
        kind="loading"
        title="Restoring session"
      />
    </div>
  );
}

export function AppShell({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const { bootstrapError, logout, online, selectTenant, session, status } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { notify } = useToast();
  const { hasDirtyChanges, requestExit } = useDirtyNavigation();
  const pathname = usePathname();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switchingTenant, setSwitchingTenant] = useState(false);
  const shellVisible = status !== 'bootstrapping' && session !== null;

  const closeMobileNavigation = useCallback((restoreTriggerFocus = true): void => {
    const dialog = dialogRef.current;
    if (dialog !== null && dialog.open) dialog.close();
    setMenuOpen(false);

    if (restoreTriggerFocus) {
      window.setTimeout(() => menuTriggerRef.current?.focus(), 0);
    }
  }, []);

  useEffect(() => {
    mainRef.current?.focus();
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen || !shellVisible) return;

    const dialog = dialogRef.current;
    if (dialog === null) return;

    const previousOverflow = document.body.style.overflow;
    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = 'hidden';
    dialog.querySelector<HTMLButtonElement>('[data-mobile-navigation-close]')?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, [menuOpen, shellVisible]);

  useEffect(() => {
    const handleResize = (): void => {
      if (window.innerWidth < 1024) return;
      if (dialogRef.current?.open === true) dialogRef.current.close();
      setMenuOpen(false);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (status === 'bootstrapping') {
    return <SessionRestoring />;
  }

  if (session === null) return <SessionRequired error={bootstrapError} />;

  const handleTenantChange = async (tenantId: string): Promise<void> => {
    if (tenantId === session.selectedTenant.tenantId) return;
    setSwitchingTenant(true);
    try {
      await selectTenant(tenantId);
      router.push('/');
    } catch (error) {
      notify(`Tenant switch failed: ${formatProblem(error)}`, 'error');
    } finally {
      setSwitchingTenant(false);
    }
  };

  const handleLogout = async (): Promise<void> => {
    try {
      await logout();
    } catch (error) {
      notify(`Sign out failed: ${formatProblem(error)}`, 'error');
    }
  };

  const handleDrawerKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMobileNavigation();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusableElements = getDrawerFocusableElements(event.currentTarget);
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements.at(-1);
    if (firstFocusable === undefined || lastFocusable === undefined) {
      event.preventDefault();
      return;
    }

    const activeElement = document.activeElement;
    if (
      event.shiftKey &&
      (activeElement === firstFocusable || !event.currentTarget.contains(activeElement))
    ) {
      event.preventDefault();
      lastFocusable.focus();
      return;
    }

    if (
      !event.shiftKey &&
      (activeElement === lastFocusable || !event.currentTarget.contains(activeElement))
    ) {
      event.preventDefault();
      firstFocusable.focus();
    }
  };

  const handleDrawerBackdropClick = (event: ReactMouseEvent<HTMLDialogElement>): void => {
    if (event.target !== event.currentTarget) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const clickedBackdrop =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (clickedBackdrop) closeMobileNavigation();
  };

  const handleDrawerNavigation = (): void => {
    closeMobileNavigation(false);
    window.setTimeout(() => mainRef.current?.focus(), 0);
  };

  const handleAppLinkClick = (
    event: ReactMouseEvent<HTMLAnchorElement>,
    href: Route,
    onAllowed?: () => void,
  ): void => {
    if (
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.currentTarget.target === '_blank'
    )
      return;

    if (!hasDirtyChanges()) {
      onAllowed?.();
      return;
    }

    event.preventDefault();
    requestExit(() => {
      onAllowed?.();
      router.push(href);
    });
  };

  return (
    <div className="qf-shell">
      <aside
        aria-label="Application sidebar"
        className="qf-sidebar qf-sidebar--desktop"
        inert={menuOpen ? true : undefined}
      >
        <SidebarContent
          online={online}
          onNavigate={(event, href) => handleAppLinkClick(event, href)}
          role={session.selectedTenant.role}
          tenantName={session.selectedTenant.tenantName}
        />
      </aside>

      {menuOpen ? (
        // The native modal owns backdrop clicks and the drawer-wide keyboard focus trap.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <dialog
          aria-label="Application navigation"
          aria-modal="true"
          className="qf-sidebar qf-mobile-navigation"
          id="mobile-navigation-dialog"
          onCancel={(event) => {
            event.preventDefault();
            closeMobileNavigation();
          }}
          onClick={handleDrawerBackdropClick}
          onKeyDown={handleDrawerKeyDown}
          ref={dialogRef}
        >
          <SidebarContent
            online={online}
            onClose={() => closeMobileNavigation()}
            onNavigate={(event, href) => handleAppLinkClick(event, href, handleDrawerNavigation)}
            role={session.selectedTenant.role}
            tenantName={session.selectedTenant.tenantName}
          />
        </dialog>
      ) : null}

      <div className="qf-shell__workspace" inert={menuOpen ? true : undefined}>
        <a className="qf-skip-link" href="#main-content">
          Skip to main content
        </a>
        <header className="qf-topbar">
          <Button
            aria-controls="mobile-navigation-dialog"
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            aria-label="Open navigation"
            className="qf-menu-button"
            icon={<Menu size={19} />}
            onClick={(event) => {
              menuTriggerRef.current = event.currentTarget;
              setMenuOpen(true);
            }}
            tone="quiet"
          />
          <div className="qf-tenant-select">
            <label htmlFor="tenant-switcher">Workspace</label>
            <span className="qf-select-wrap">
              <select
                disabled={switchingTenant}
                id="tenant-switcher"
                onChange={(event) => {
                  const tenantId = event.currentTarget.value;
                  if (tenantId === session.selectedTenant.tenantId) return;
                  requestExit(() => void handleTenantChange(tenantId));
                }}
                value={session.selectedTenant.tenantId}
              >
                <optgroup label="Your workspaces">
                  {session.memberships
                    .filter((membership) => !/^E2E Tenant\b/i.test(membership.tenantName))
                    .map((membership) => (
                      <option key={membership.tenantId} value={membership.tenantId}>
                        {membership.tenantName} · {membership.role.replaceAll('_', ' ')}
                      </option>
                    ))}
                </optgroup>
                {session.memberships.some((membership) =>
                  /^E2E Tenant\b/i.test(membership.tenantName),
                ) ? (
                  <optgroup label="Verification workspaces">
                    {session.memberships
                      .filter((membership) => /^E2E Tenant\b/i.test(membership.tenantName))
                      .map((membership) => (
                        <option key={membership.tenantId} value={membership.tenantId}>
                          {membership.tenantName} · {membership.role.replaceAll('_', ' ')}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
              </select>
              <ChevronDown aria-hidden="true" size={15} />
            </span>
          </div>
          <div className="qf-topbar__actions">
            <span className="qf-identity">
              <strong>{session.user.displayName}</strong>
              <small>{session.user.email}</small>
            </span>
            <Link
              aria-label="Open notifications"
              className="qf-icon-link"
              href="/notifications"
              onClick={(event) => handleAppLinkClick(event, '/notifications')}
              prefetch={false}
            >
              <Bell size={18} />
            </Link>
            <Button
              aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} theme`}
              icon={theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
              onClick={toggleTheme}
              tone="quiet"
            />
            <Button
              aria-label="Sign out"
              disabled={!online}
              icon={<LogOut size={18} />}
              onClick={() => requestExit(() => void handleLogout())}
              tone="quiet"
            />
          </div>
        </header>
        {!online ? (
          <div className="qf-offline-banner" role="status">
            <ShieldCheck size={16} aria-hidden="true" />
            Offline. Current data stays visible; commands are disabled until the local API
            reconnects.
          </div>
        ) : null}
        <main id="main-content" className="qf-main" ref={mainRef} tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
