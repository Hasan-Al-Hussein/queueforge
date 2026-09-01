'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
  AuthSessionSchema,
  LoginRequestSchema,
  type AuthSession,
  type LoginRequest,
  type TenantRole,
} from '@queueforge/contracts';

import {
  apiRequest,
  ApiProblem,
  configureAuthRecovery,
  getCsrfToken,
  recoverAuthenticationSession,
  setAccessToken,
} from '../api/client';
import { routes } from '../api/routes';
import { SHOWCASE_MODE } from '../demo/mode';
import { showcaseRoleFromEmail, showcaseSession, showcaseSessionForTenant } from '../demo/session';

export type Permission =
  | 'read'
  | 'approve'
  | 'submit'
  | 'cancel'
  | 'retry'
  | 'replay'
  | 'configure_workflows'
  | 'configure_webhooks'
  | 'manage_team';

type AuthStatus = 'bootstrapping' | 'anonymous' | 'authenticated';

interface AuthContextValue {
  readonly bootstrapError: string | null;
  readonly can: (permission: Permission) => boolean;
  readonly login: (input: LoginRequest) => Promise<void>;
  readonly logout: () => Promise<void>;
  readonly online: boolean;
  readonly selectTenant: (tenantId: string) => Promise<void>;
  readonly session: AuthSession | null;
  readonly status: AuthStatus;
}

const ROLE_PERMISSIONS: Readonly<Record<TenantRole, ReadonlySet<Permission>>> = {
  viewer: new Set(['read']),
  approver: new Set(['read', 'approve']),
  operator: new Set(['read', 'submit', 'cancel', 'retry', 'replay']),
  tenant_admin: new Set([
    'read',
    'approve',
    'submit',
    'cancel',
    'retry',
    'replay',
    'configure_workflows',
    'configure_webhooks',
    'manage_team',
  ]),
};

const AuthContext = createContext<AuthContextValue | null>(null);

function subscribeToOnlineState(onStoreChange: () => void): () => void {
  window.addEventListener('online', onStoreChange);
  window.addEventListener('offline', onStoreChange);
  return () => {
    window.removeEventListener('online', onStoreChange);
    window.removeEventListener('offline', onStoreChange);
  };
}

function getOnlineSnapshot(): boolean {
  return navigator.onLine;
}

function getServerOnlineSnapshot(): boolean {
  return true;
}

function useOnlineState(): boolean {
  return useSyncExternalStore(subscribeToOnlineState, getOnlineSnapshot, getServerOnlineSnapshot);
}

export function AuthProvider({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<AuthStatus>('bootstrapping');
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const browserOnline = useOnlineState();
  const online = SHOWCASE_MODE || browserOnline;

  const applySession = useCallback((nextSession: AuthSession | null): void => {
    setAccessToken(SHOWCASE_MODE ? null : (nextSession?.accessToken ?? null));
    setSession(nextSession);
    setStatus(nextSession === null ? 'anonymous' : 'authenticated');
  }, []);

  const refreshSession = useCallback(async (): Promise<void> => {
    if (SHOWCASE_MODE) {
      applySession(null);
      return;
    }
    const nextSession = await apiRequest(routes.auth.refresh, {
      csrf: true,
      method: 'POST',
      retryAuthentication: false,
      schema: AuthSessionSchema,
    });
    applySession(nextSession);
  }, [applySession]);

  useEffect(
    () =>
      configureAuthRecovery({
        clearSession: () => applySession(null),
        refreshSession,
      }),
    [applySession, refreshSession],
  );

  const bootstrap = useCallback(async (): Promise<void> => {
    setBootstrapError(null);
    if (SHOWCASE_MODE) {
      applySession(null);
      return;
    }
    // Refresh requires the readable double-submit CSRF cookie. When it is absent,
    // a refresh request cannot succeed, which is the normal state on a first visit.
    if (getCsrfToken() === null) {
      applySession(null);
      return;
    }

    try {
      const recoveryConfigured = await recoverAuthenticationSession();
      if (!recoveryConfigured) throw new Error('Authentication recovery is not configured.');
    } catch (error) {
      applySession(null);
      if (error instanceof ApiProblem && [401, 403].includes(error.status)) return;
      setBootstrapError(
        navigator.onLine
          ? 'Session restore failed. Sign in again to continue.'
          : 'The API is offline.',
      );
    }
  }, [applySession]);

  useEffect(() => {
    const timer = window.setTimeout(() => void bootstrap(), 0);
    return () => window.clearTimeout(timer);
  }, [bootstrap]);

  const login = useCallback(
    async (input: LoginRequest): Promise<void> => {
      if (SHOWCASE_MODE) {
        applySession(showcaseSession(showcaseRoleFromEmail(input.email)));
        return;
      }
      const validated = LoginRequestSchema.parse(input);
      const nextSession = await apiRequest(routes.auth.login, {
        body: validated,
        method: 'POST',
        retryAuthentication: false,
        schema: AuthSessionSchema,
      });
      applySession(nextSession);
    },
    [applySession],
  );

  const logout = useCallback(async (): Promise<void> => {
    if (SHOWCASE_MODE) {
      applySession(null);
      return;
    }
    await apiRequest<void>(routes.auth.logout, {
      csrf: true,
      method: 'POST',
      retryAuthentication: false,
    });
    applySession(null);
  }, [applySession]);

  const selectTenant = useCallback(
    async (tenantId: string): Promise<void> => {
      if (SHOWCASE_MODE) {
        applySession(showcaseSessionForTenant(tenantId));
        return;
      }
      const nextSession = await apiRequest(routes.auth.selectTenant, {
        body: { tenantId },
        csrf: true,
        method: 'POST',
        schema: AuthSessionSchema,
      });
      applySession(nextSession);
    },
    [applySession],
  );

  const can = useCallback(
    (permission: Permission): boolean => {
      if (session === null) return false;
      if (session.user.platformRole === 'platform_admin') return true;
      return ROLE_PERMISSIONS[session.selectedTenant.role].has(permission);
    },
    [session],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ bootstrapError, can, login, logout, online, selectTenant, session, status }),
    [bootstrapError, can, login, logout, online, selectTenant, session, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
