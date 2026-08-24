import type { CookieOptions, Response } from 'express';

import type { AuthCookiesResult, AuthService } from '@queueforge/application';
import type { RuntimeEnvironment } from '@queueforge/config';
import type { AuthSession, LoginRequest } from '@queueforge/contracts';

import type { QueueForgeRequest } from '../common/http-context.js';
import { AuthController } from './auth.controller.js';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const TENANT_ID = '20000000-0000-4000-8000-000000000001';
const CORRELATION_ID = '30000000-0000-4000-8000-000000000001';
const WEB_ORIGIN = 'http://127.0.0.1:3100';

const environment = {
  COOKIE_SECURE: true,
  CSRF_COOKIE_NAME: 'qf_csrf',
  REFRESH_COOKIE_NAME: 'qf_refresh',
  WEB_ORIGIN,
} as RuntimeEnvironment;

const session: AuthSession = {
  accessToken: 'access-token',
  accessTokenExpiresAt: '2026-08-24T01:00:00.000Z',
  csrfToken: 'c'.repeat(32),
  memberships: [{ tenantId: TENANT_ID, tenantName: 'Acme', tenantSlug: 'acme', role: 'operator' }],
  selectedTenant: {
    tenantId: TENANT_ID,
    tenantName: 'Acme',
    tenantSlug: 'acme',
    role: 'operator',
  },
  user: {
    id: USER_ID,
    displayName: 'Demo User',
    email: 'demo@example.test',
    platformRole: null,
  },
};

function requestFixture(
  headers: Readonly<Record<string, string | undefined>>,
  cookies: Readonly<Record<string, string>> = {},
): QueueForgeRequest {
  return {
    cookies,
    header: (name: string) => headers[name.toLowerCase()],
    ip: '127.0.0.1',
  } as QueueForgeRequest;
}

function responseFixture(): {
  readonly clearCookieCalls: Array<{ name: string; options: CookieOptions }>;
  readonly cookieCalls: Array<{ name: string; options: CookieOptions; value: string }>;
  readonly response: Response;
} {
  const cookieCalls: Array<{ name: string; options: CookieOptions; value: string }> = [];
  const clearCookieCalls: Array<{ name: string; options: CookieOptions }> = [];
  const response = {
    clearCookie(name: string, options: CookieOptions) {
      clearCookieCalls.push({ name, options });
    },
    cookie(name: string, value: string, options: CookieOptions) {
      cookieCalls.push({ name, value, options });
    },
  } as unknown as Response;
  return { clearCookieCalls, cookieCalls, response };
}

function authResult(): AuthCookiesResult {
  return {
    session,
    refreshToken: 'refresh-token',
    refreshExpiresAt: new Date('2026-08-31T00:00:00.000Z'),
  };
}

describe('AuthController browser security', () => {
  const loginInput: LoginRequest = {
    email: 'demo@example.test',
    password: 'correct-password',
  };

  it('rejects login from a missing or untrusted origin before password verification', async () => {
    const login = jest.fn();
    const controller = new AuthController({ login } as unknown as AuthService, environment);
    const response = responseFixture();

    await expect(
      controller.login(loginInput, requestFixture({}), response.response, CORRELATION_ID),
    ).rejects.toMatchObject({ code: 'CSRF_VALIDATION_FAILED' });
    await expect(
      controller.login(
        loginInput,
        requestFixture({ origin: 'https://attacker.example' }),
        response.response,
        CORRELATION_ID,
      ),
    ).rejects.toMatchObject({ code: 'CSRF_VALIDATION_FAILED' });
    expect(login).not.toHaveBeenCalled();
  });

  it('sets a HttpOnly refresh cookie and a script-readable double-submit CSRF cookie', async () => {
    const login = jest.fn().mockResolvedValue(authResult());
    const controller = new AuthController({ login } as unknown as AuthService, environment);
    const response = responseFixture();

    await expect(
      controller.login(
        loginInput,
        requestFixture({ origin: WEB_ORIGIN, 'user-agent': 'jest' }),
        response.response,
        CORRELATION_ID,
      ),
    ).resolves.toBe(session);

    expect(response.cookieCalls).toEqual([
      {
        name: 'qf_refresh',
        value: 'refresh-token',
        options: expect.objectContaining({ httpOnly: true, path: '/api/v1/auth', secure: true }),
      },
      {
        name: 'qf_csrf',
        value: session.csrfToken,
        options: expect.objectContaining({ httpOnly: false, path: '/', secure: true }),
      },
    ]);
  });

  it('requires both the CSRF header and cookie before refresh reaches the auth service', async () => {
    const refresh = jest.fn();
    const controller = new AuthController({ refresh } as unknown as AuthService, environment);
    const response = responseFixture();
    const request = requestFixture(
      { origin: WEB_ORIGIN },
      { qf_refresh: 'refresh-token', qf_csrf: 'csrf-cookie' },
    );

    await expect(
      controller.refresh(request, response.response, undefined, CORRELATION_ID),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(refresh).not.toHaveBeenCalled();
  });
});
