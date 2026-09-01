'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  ApiProblem,
  fetchWithAuthRecovery,
  getAccessToken,
  isGraphqlAuthenticationFailure,
} from '../api/client';
import { SessionRequired, SessionRestoring } from '../components/app-shell';
import { CinematicMotionProvider } from '../components/cinematic-motion';
import { createShowcaseApolloLink } from '../demo/apollo-link';
import { assertLocalTransportAllowed, SHOWCASE_MODE } from '../demo/mode';
import { LoginScreen } from '../features/auth/login-screen';
import { AuthProvider, useAuth } from './auth-provider';
import { DirtyNavigationProvider } from './dirty-navigation-provider';
import { ThemeProvider } from './theme-provider';
import { ToastProvider } from './toast-provider';

export function isLoginPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === '/login';
}

function createLocalHttpLink(): HttpLink {
  assertLocalTransportAllowed();
  return new HttpLink({
    credentials: 'include',
    fetch: (uri, options) =>
      fetchWithAuthRecovery(
        uri,
        () => {
          const headers = new Headers(options?.headers);
          const token = getAccessToken();
          if (token !== null) headers.set('Authorization', `Bearer ${token}`);
          return { ...options, headers };
        },
        true,
        isGraphqlAuthenticationFailure,
      ),
    uri: process.env.QF_QUERY_ORIGIN ?? '',
  });
}

function createApolloClient(): ApolloClient {
  return new ApolloClient({
    cache: new InMemoryCache(),
    defaultOptions: {
      query: { fetchPolicy: 'network-only' },
      watchQuery: { fetchPolicy: 'cache-and-network', nextFetchPolicy: 'cache-first' },
    },
    link: SHOWCASE_MODE ? createShowcaseApolloLink() : createLocalHttpLink(),
  });
}

function TenantDataProviders({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
          queries: {
            refetchOnWindowFocus: false,
            retry: (failureCount, error) =>
              failureCount < 1 &&
              (SHOWCASE_MODE || navigator.onLine) &&
              !(error instanceof TypeError) &&
              !(error instanceof ApiProblem && [401, 403].includes(error.status)),
            staleTime: 10_000,
          },
        },
      }),
  );
  const [apolloClient] = useState(createApolloClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ApolloProvider client={apolloClient}>
        <ToastProvider>{children}</ToastProvider>
      </ApolloProvider>
    </QueryClientProvider>
  );
}

function TenantDataBoundary({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const { bootstrapError, session, status } = useAuth();
  const pathname = usePathname();
  if (status === 'bootstrapping') return <SessionRestoring />;
  if (status === 'anonymous') {
    const loginPath = isLoginPath(pathname);
    if (SHOWCASE_MODE) {
      return <ToastProvider>{loginPath ? children : <LoginScreen />}</ToastProvider>;
    }
    if (loginPath) return <ToastProvider>{children}</ToastProvider>;
    return <SessionRequired error={bootstrapError} />;
  }
  const tenantCacheKey = session?.selectedTenant.tenantId ?? 'anonymous';
  return <TenantDataProviders key={tenantCacheKey}>{children}</TenantDataProviders>;
}

export function AppProviders({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return (
    <CinematicMotionProvider>
      <ThemeProvider>
        <DirtyNavigationProvider>
          <AuthProvider>
            <TenantDataBoundary>{children}</TenantDataBoundary>
          </AuthProvider>
        </DirtyNavigationProvider>
      </ThemeProvider>
    </CinematicMotionProvider>
  );
}
