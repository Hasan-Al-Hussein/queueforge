import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import {
  apiRequest,
  ApiProblem,
  configureAuthRecovery,
  fetchWithAuthRecovery,
  getAccessToken,
  isForbiddenProblem,
  isGraphqlAuthenticationFailure,
  recoverAuthenticationSession,
  setAccessToken,
} from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function requestWithCurrentToken(): RequestInit {
  const headers = new Headers();
  const token = getAccessToken();
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);
  return { headers };
}

afterEach(() => {
  setAccessToken(null);
  vi.unstubAllGlobals();
});

describe('authentication recovery', () => {
  it('single-flights one refresh for concurrent REST and Apollo requests', async () => {
    setAccessToken('expired-token');
    let releaseRefresh: (() => void) | undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshSession = vi.fn(async () => {
      await refreshGate;
      setAccessToken('fresh-token');
    });
    const clearSession = vi.fn(() => setAccessToken(null));
    const dispose = configureAuthRecovery({ clearSession, refreshSession });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('Authorization');
      if (authorization !== 'Bearer fresh-token') return jsonResponse({ expired: true }, 401);
      return jsonResponse(
        String(input).endsWith('/graphql') ? { data: { ok: true } } : { ok: true },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const restRequest = apiRequest<{ readonly ok: boolean }>('/api/v1/requests');
    const apolloRequest = fetchWithAuthRecovery(
      'http://127.0.0.1:3001/graphql',
      requestWithCurrentToken,
    );

    await waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
    releaseRefresh?.();

    await expect(restRequest).resolves.toEqual({ ok: true });
    await expect(apolloRequest.then((response) => response.json())).resolves.toEqual({
      data: { ok: true },
    });
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(clearSession).not.toHaveBeenCalled();
    dispose();
  });

  it('single-flights cold-load bootstrap with an HTTP-200 GraphQL authentication failure', async () => {
    setAccessToken('expired-token');
    let releaseRefresh: (() => void) | undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshSession = vi.fn(async () => {
      await refreshGate;
      setAccessToken('fresh-token');
    });
    const clearSession = vi.fn(() => setAccessToken(null));
    const dispose = configureAuthRecovery({ clearSession, refreshSession });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('Authorization');
      return authorization === 'Bearer fresh-token'
        ? jsonResponse({ data: { dashboardOverview: { ok: true } } })
        : jsonResponse({
            errors: [
              {
                extensions: { code: 'AUTHENTICATION_REQUIRED' },
                message: 'Access token expired.',
              },
            ],
          });
    });
    vi.stubGlobal('fetch', fetchMock);

    const bootstrap = recoverAuthenticationSession();
    const graphqlRequest = fetchWithAuthRecovery(
      'http://127.0.0.1:3001/graphql',
      requestWithCurrentToken,
      true,
      isGraphqlAuthenticationFailure,
    );

    await waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
    releaseRefresh?.();

    await expect(bootstrap).resolves.toBe(true);
    await expect(graphqlRequest.then((response) => response.json())).resolves.toEqual({
      data: { dashboardOverview: { ok: true } },
    });
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(clearSession).not.toHaveBeenCalled();
    dispose();
  });

  it('retries a rejected request once and clears auth if the fresh token is rejected', async () => {
    setAccessToken('expired-token');
    const refreshSession = vi.fn(async () => setAccessToken('fresh-token'));
    const clearSession = vi.fn(() => setAccessToken(null));
    const dispose = configureAuthRecovery({ clearSession, refreshSession });
    const fetchMock = vi.fn(async () => jsonResponse({ expired: true }, 401));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithAuthRecovery(
      'http://127.0.0.1:3001/graphql',
      requestWithCurrentToken,
    );

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
    dispose();
  });

  it('clears auth once when a shared refresh fails', async () => {
    setAccessToken('expired-token');
    const refreshFailure = new ApiProblem({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Refresh family is no longer valid.',
      status: 401,
    });
    const refreshSession = vi.fn(async () => Promise.reject(refreshFailure));
    const clearSession = vi.fn(() => setAccessToken(null));
    const dispose = configureAuthRecovery({ clearSession, refreshSession });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ expired: true }, 401)),
    );

    const first = fetchWithAuthRecovery('http://127.0.0.1:3001/graphql', requestWithCurrentToken);
    const second = apiRequest('/api/v1/approvals');

    await expect(Promise.all([first, second])).rejects.toBe(refreshFailure);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
    dispose();
  });

  it('recognizes the shared GraphQL authorization denial code', () => {
    expect(isForbiddenProblem({ errors: [{ extensions: { code: 'AUTHORIZATION_DENIED' } }] })).toBe(
      true,
    );
    expect(isForbiddenProblem({ errors: [{ extensions: { code: 'FORBIDDEN' } }] })).toBe(false);
  });
});
