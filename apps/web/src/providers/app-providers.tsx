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
import { AuthProvider, useAuth } from './auth-provider';
import { DirtyNavigationProvider } from './dirty-navigation-provider';
import { ThemeProvider } from './theme-provider';
import { ToastProvider } from './toast-provider';

const GRAPHQL_URL = process.env.NEXT_PUBLIC_GRAPHQL_URL ?? 'http://127.0.0.1:3001/graphql';

function createApolloClient(): ApolloClient {
  const httpLink = new HttpLink({
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
    uri: GRAPHQL_URL,
  });

  return new ApolloClient({
    cache: new InMemoryCache(),
    defaultOptions: {
      query: { fetchPolicy: 'network-only' },
      watchQuery: { fetchPolicy: 'cache-and-network', nextFetchPolicy: 'cache-first' },
    },
    link: httpLink,
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
              navigator.onLine &&
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
    if (pathname === '/login') return <ToastProvider>{children}</ToastProvider>;
    return <SessionRequired error={bootstrapError} />;
  }
  const tenantCacheKey = session?.selectedTenant.tenantId ?? 'anonymous';
  return <TenantDataProviders key={tenantCacheKey}>{children}</TenantDataProviders>;
}

export function AppProviders({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return (
    <ThemeProvider>
      <DirtyNavigationProvider>
        <AuthProvider>
          <TenantDataBoundary>{children}</TenantDataBoundary>
        </AuthProvider>
      </DirtyNavigationProvider>
    </ThemeProvider>
  );
}
