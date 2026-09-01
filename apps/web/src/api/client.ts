import { ErrorEnvelopeSchema, type ErrorCode } from '@queueforge/contracts';
import type { ZodType } from 'zod';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001').replace(
  /\/$/,
  '',
);
const CSRF_COOKIE_NAME = process.env.NEXT_PUBLIC_CSRF_COOKIE_NAME ?? 'qf_csrf';

let accessToken: string | null = null;
let authRecoveryHandlers: AuthRecoveryHandlers | null = null;
let refreshInFlight: Promise<void> | null = null;

export interface AuthRecoveryHandlers {
  readonly clearSession: () => void;
  readonly refreshSession: () => Promise<void>;
}

export function configureAuthRecovery(handlers: AuthRecoveryHandlers): () => void {
  authRecoveryHandlers = handlers;
  return () => {
    if (authRecoveryHandlers === handlers) authRecoveryHandlers = null;
  };
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${encodeURIComponent(CSRF_COOKIE_NAME)}=`;
  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (cookie === undefined) return null;
  try {
    return decodeURIComponent(cookie.slice(prefix.length));
  } catch {
    return null;
  }
}

export class ApiProblem extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE';
  readonly correlationId?: string;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;
  readonly status: number;

  constructor(options: {
    readonly code: ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE';
    readonly correlationId?: string;
    readonly details?: Record<string, unknown>;
    readonly message: string;
    readonly requestId?: string;
    readonly status: number;
  }) {
    super(options.message);
    this.name = 'ApiProblem';
    this.code = options.code;
    this.status = options.status;
    this.correlationId = options.correlationId;
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

export interface ApiRequestOptions<T> {
  readonly body?: unknown;
  readonly csrf?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
  readonly idempotencyKey?: string;
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly retryAuthentication?: boolean;
  readonly schema?: ZodType<T>;
  readonly signal?: AbortSignal;
}

export async function recoverAuthenticationSession(): Promise<boolean> {
  const handlers = authRecoveryHandlers;
  if (handlers === null) return false;

  if (refreshInFlight === null) {
    refreshInFlight = handlers
      .refreshSession()
      .catch((error: unknown) => {
        handlers.clearSession();
        throw error;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }

  await refreshInFlight;
  return true;
}

export async function fetchWithAuthRecovery(
  input: RequestInfo | URL,
  createInit: () => RequestInit,
  retryAuthentication = true,
  isAuthenticationFailure: (response: Response) => boolean | Promise<boolean> = (response) =>
    response.status === 401,
): Promise<Response> {
  const tokenAtFirstAttempt = accessToken;
  const response = await fetch(input, createInit());
  if (!(await isAuthenticationFailure(response)) || !retryAuthentication) return response;

  const tokenChanged = accessToken !== tokenAtFirstAttempt;
  const recovered = tokenChanged || (await recoverAuthenticationSession());
  if (!recovered) return response;

  const retriedResponse = await fetch(input, createInit());
  if (await isAuthenticationFailure(retriedResponse)) authRecoveryHandlers?.clearSession();
  return retriedResponse;
}

export async function isGraphqlAuthenticationFailure(response: Response): Promise<boolean> {
  if (response.status === 401) return true;
  if (response.status !== 200) return false;

  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return false;
  }
  if (body === null || typeof body !== 'object') return false;
  const errors = (body as Readonly<Record<string, unknown>>)['errors'];
  if (!Array.isArray(errors)) return false;
  return errors.some((error: unknown) => {
    if (error === null || typeof error !== 'object') return false;
    const extensions = (error as Readonly<Record<string, unknown>>)['extensions'];
    return (
      extensions !== null &&
      typeof extensions === 'object' &&
      (extensions as Readonly<Record<string, unknown>>)['code'] === 'AUTHENTICATION_REQUIRED'
    );
  });
}

async function readError(response: Response): Promise<ApiProblem> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new ApiProblem({
      code: 'INVALID_RESPONSE',
      message: `The API returned HTTP ${String(response.status)} without a valid error envelope.`,
      status: response.status,
    });
  }

  const parsed = ErrorEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    return new ApiProblem({
      code: 'INVALID_RESPONSE',
      message: `The API returned HTTP ${String(response.status)} with an unexpected response.`,
      status: response.status,
    });
  }

  return new ApiProblem({
    code: parsed.data.error.code,
    correlationId: parsed.data.correlationId,
    details: parsed.data.error.details,
    message: parsed.data.error.message,
    requestId: parsed.data.requestId,
    status: response.status,
  });
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions<T> = {}): Promise<T> {
  const method = options.method ?? 'GET';

  let response: Response;
  try {
    response = await fetchWithAuthRecovery(
      `${API_BASE_URL}${path}`,
      () => {
        const headers = new Headers(options.headers);
        headers.set('Accept', 'application/json');
        if (options.body !== undefined) headers.set('Content-Type', 'application/json');
        if (accessToken !== null) headers.set('Authorization', `Bearer ${accessToken}`);
        if (options.idempotencyKey !== undefined) {
          headers.set('Idempotency-Key', options.idempotencyKey);
        }
        if (options.csrf === true) {
          const csrfToken = getCsrfToken();
          if (csrfToken !== null) headers.set('X-CSRF-Token', csrfToken);
        }
        return {
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          credentials: 'include',
          headers,
          method,
          signal: options.signal,
        };
      },
      options.retryAuthentication ?? true,
    );
  } catch (error) {
    if (error instanceof ApiProblem) throw error;
    throw new ApiProblem({
      code: 'NETWORK_ERROR',
      message: error instanceof Error ? error.message : 'The QueueForge API is unreachable.',
      status: 0,
    });
  }

  if (!response.ok) throw await readError(response);
  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json();
  if (options.schema === undefined) return body as T;
  const parsed = options.schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiProblem({
      code: 'INVALID_RESPONSE',
      details: { issues: parsed.error.issues },
      message: 'The API response did not match the QueueForge contract.',
      status: response.status,
    });
  }
  return parsed.data;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function isOfflineProblem(error: unknown): boolean {
  return (
    (error instanceof ApiProblem && error.status === 0) ||
    (typeof navigator !== 'undefined' && !navigator.onLine)
  );
}

export function isForbiddenProblem(error: unknown): boolean {
  if (error instanceof ApiProblem) return error.status === 403;
  if (typeof error !== 'object' || error === null) return false;
  const errorFields = error as Readonly<Record<string, unknown>>;
  const errorCollections: readonly unknown[] = [
    errorFields['errors'],
    errorFields['graphQLErrors'],
  ];
  return errorCollections.some((candidate) => {
    if (!Array.isArray(candidate)) return false;
    return candidate.some((item: unknown) => {
      if (typeof item !== 'object' || item === null) return false;
      const extensions = (item as Readonly<Record<string, unknown>>)['extensions'];
      return (
        typeof extensions === 'object' &&
        extensions !== null &&
        (extensions as Readonly<Record<string, unknown>>)['code'] === 'AUTHORIZATION_DENIED'
      );
    });
  });
}

export function isNotFoundProblem(error: unknown): boolean {
  if (error instanceof ApiProblem) return error.status === 404;
  if (error instanceof Error && /\bnot found\b/iu.test(error.message)) return true;
  if (typeof error !== 'object' || error === null) return false;
  const fields = error as Readonly<Record<string, unknown>>;
  return fields['status'] === 404 || fields['code'] === 'NOT_FOUND';
}

export function formatProblem(error: unknown): string {
  if (error instanceof ApiProblem) return error.message;
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred.';
}
