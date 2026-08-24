import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { argon2id, hash, verify } from 'argon2';

import type { RuntimeEnvironment } from '@queueforge/config';
import {
  UuidSchema,
  type AuthSession,
  type LoginRequest,
  type Membership,
  type PlatformRole,
  type PrincipalKind,
  type TenantContext,
  type TenantRole,
} from '@queueforge/contracts';
import { IdentityStore, type LoginUserRecord } from '@queueforge/persistence';

import { RUNTIME_ENVIRONMENT } from './configuration.js';
import { ApplicationError } from './errors.js';

const REFRESH_SECRET_BYTES = 32;
const CSRF_BYTES = 32;
const PASSWORD_HASH_OPTIONS = Object.freeze({
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

interface AccessTokenPayload {
  readonly sub: string;
  readonly tid: string;
  readonly role: TenantRole | 'platform_admin';
  readonly pk: PrincipalKind;
  readonly sid: string;
  readonly email: string;
  readonly platformRole: PlatformRole | null;
}

export interface AuthCookiesResult {
  readonly session: AuthSession;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

export interface CurrentSessionView {
  readonly memberships: readonly Membership[];
  readonly selectedTenant: Membership;
  readonly user: {
    readonly id: string;
    readonly displayName: string;
    readonly email: string;
    readonly platformRole: PlatformRole | null;
  };
}

export interface AuthRequestMetadata {
  readonly correlationId: string;
  readonly sourceIp: string | null;
  readonly userAgent: string | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function parseRefreshToken(rawToken: string): { tokenId: string; secret: string } {
  const separator = rawToken.indexOf('.');
  if (separator < 1) {
    throw new ApplicationError('INVALID_CREDENTIALS', 'Refresh session is invalid');
  }
  const tokenId = rawToken.slice(0, separator);
  const secret = rawToken.slice(separator + 1);
  if (!UuidSchema.safeParse(tokenId).success || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    throw new ApplicationError('INVALID_CREDENTIALS', 'Refresh session is invalid');
  }
  return { tokenId, secret };
}

@Injectable()
export class AuthService {
  private readonly dummyPasswordHash = hash('queueforge-invalid-password', PASSWORD_HASH_OPTIONS);

  public constructor(
    private readonly identity: IdentityStore,
    private readonly jwt: JwtService,
    @Inject(RUNTIME_ENVIRONMENT) private readonly environment: RuntimeEnvironment,
  ) {}

  public async login(
    input: LoginRequest,
    metadata: AuthRequestMetadata,
  ): Promise<AuthCookiesResult> {
    const user = await this.identity.findUserForLogin(input.email);
    const valid =
      user !== null
        ? await verify(user.passwordHash, input.password)
        : await this.performDummyPasswordVerification(input.password);
    if (user === null || valid !== true || !user.isActive) {
      await this.identity.recordAuthEvent({
        userId: user?.id ?? null,
        eventType: 'auth.login_failed',
        correlationId: metadata.correlationId,
        sourceIp: metadata.sourceIp,
        metadata: { reason: 'invalid_credentials' },
      });
      throw new ApplicationError('INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    const memberships = await this.identity.listMemberships(user.id);
    const selected =
      input.tenantId !== undefined
        ? memberships.find((membership) => membership.tenantId === input.tenantId)
        : memberships[0];
    if (selected === undefined) {
      throw new ApplicationError('AUTHORIZATION_DENIED', 'No active membership is available');
    }
    const refreshSecret = randomBytes(REFRESH_SECRET_BYTES).toString('base64url');
    const csrfToken = randomBytes(CSRF_BYTES).toString('base64url');
    const now = Date.now();
    const refreshExpiresAt = new Date(now + this.environment.REFRESH_TOKEN_TTL_SECONDS * 1_000);
    const familyExpiresAt = new Date(now + this.environment.REFRESH_FAMILY_TTL_SECONDS * 1_000);
    const refreshHash = await this.hashRefreshSecret(refreshSecret);
    const familyId = randomUUID();
    const tokenId = randomUUID();
    const session = await this.createSession(user, memberships, selected, familyId, csrfToken);
    const record = await this.identity.createRefreshSession({
      familyId,
      tokenId,
      userId: user.id,
      selectedTenantId: selected.tenantId,
      csrfHash: this.hashCsrf(csrfToken),
      tokenHash: refreshHash,
      familyExpiresAt,
      tokenExpiresAt: refreshExpiresAt,
      userAgentHash: metadata.userAgent !== null ? sha256(metadata.userAgent) : null,
      sourceIp: metadata.sourceIp,
      audit: {
        userId: user.id,
        tenantId: selected.tenantId,
        eventType: 'auth.login_succeeded',
        correlationId: metadata.correlationId,
        sourceIp: metadata.sourceIp,
        metadata: { sessionId: familyId },
      },
    });
    return {
      session,
      refreshToken: `${record.tokenId}.${refreshSecret}`,
      refreshExpiresAt,
    };
  }

  public async refresh(
    rawRefreshToken: string,
    csrfHeader: string,
    csrfCookie: string,
    metadata: AuthRequestMetadata,
  ): Promise<AuthCookiesResult> {
    this.assertDoubleSubmitCsrf(csrfHeader, csrfCookie);
    const parsed = parseRefreshToken(rawRefreshToken);
    const nextSecret = this.deriveSuccessorRefreshSecret(rawRefreshToken);
    const refreshExpiresAt = new Date(
      Date.now() + this.environment.REFRESH_TOKEN_TTL_SECONDS * 1_000,
    );
    const rotation = await this.identity.rotateRefresh({
      tokenId: parsed.tokenId,
      verifyTokenHash: (storedHash) =>
        verify(storedHash, parsed.secret + this.environment.REFRESH_TOKEN_PEPPER),
      verifyCsrfHash: (storedHash) => safeEqual(storedHash, this.hashCsrf(csrfHeader)),
      nextTokenHash: await this.hashRefreshSecret(nextSecret),
      nextTokenExpiresAt: refreshExpiresAt,
      audit: {
        correlationId: metadata.correlationId,
        sourceIp: metadata.sourceIp,
        userAgentHash: metadata.userAgent !== null ? sha256(metadata.userAgent) : null,
      },
      issueSession: ({ familyId, memberships, selected, user }) =>
        this.createSession(
          { ...user, passwordHash: '' },
          memberships,
          selected,
          familyId,
          csrfHeader,
        ),
    });
    if (rotation.outcome === 'reuse') {
      throw new ApplicationError(
        'TOKEN_REUSE_DETECTED',
        'Refresh token reuse was detected; the session family was revoked',
      );
    }
    if (rotation.outcome === 'csrf_invalid') {
      throw new ApplicationError('CSRF_VALIDATION_FAILED', 'CSRF validation failed');
    }
    if (rotation.outcome === 'invalid') {
      throw new ApplicationError('INVALID_CREDENTIALS', 'Refresh session is invalid');
    }
    return {
      session: rotation.session,
      refreshToken: `${rotation.tokenId}.${nextSecret}`,
      refreshExpiresAt,
    };
  }

  public async logout(
    context: TenantContext,
    csrfHeader: string,
    csrfCookie: string,
    metadata: AuthRequestMetadata,
  ): Promise<void> {
    this.assertDoubleSubmitCsrf(csrfHeader, csrfCookie);
    if (context.sessionId === undefined) {
      throw new ApplicationError('AUTHENTICATION_REQUIRED', 'User session is required');
    }
    const storedHash = await this.identity.getFamilyCsrfHash(
      context.sessionId,
      context.principalId,
    );
    if (storedHash === null || !safeEqual(storedHash, this.hashCsrf(csrfHeader))) {
      throw new ApplicationError('CSRF_VALIDATION_FAILED', 'CSRF validation failed');
    }
    await this.identity.revokeFamily(context.sessionId, context.principalId, 'logout', {
      userId: context.principalId,
      tenantId: context.tenantId,
      eventType: 'auth.logout',
      correlationId: metadata.correlationId,
      sourceIp: metadata.sourceIp,
      metadata: { sessionId: context.sessionId },
    });
  }

  public async selectTenant(
    context: TenantContext,
    tenantId: string,
    csrfHeader: string,
    csrfCookie: string,
    metadata: AuthRequestMetadata,
  ): Promise<AuthSession> {
    this.assertDoubleSubmitCsrf(csrfHeader, csrfCookie);
    if (context.sessionId === undefined || context.principalKind !== 'user') {
      throw new ApplicationError('AUTHENTICATION_REQUIRED', 'User session is required');
    }
    const storedHash = await this.identity.getFamilyCsrfHash(
      context.sessionId,
      context.principalId,
    );
    if (storedHash === null || !safeEqual(storedHash, this.hashCsrf(csrfHeader))) {
      throw new ApplicationError('CSRF_VALIDATION_FAILED', 'CSRF validation failed');
    }
    const selected = await this.identity.selectTenant(
      context.sessionId,
      context.principalId,
      tenantId,
      {
        correlationId: metadata.correlationId,
        previousTenantId: context.tenantId,
        sourceIp: metadata.sourceIp,
      },
    );
    const user = await this.identity.findUserById(context.principalId);
    if (user === null || !user.isActive) {
      throw new ApplicationError('AUTHENTICATION_REQUIRED', 'User account is unavailable');
    }
    const memberships = await this.identity.listMemberships(user.id);
    return this.createSession(
      { ...user, passwordHash: '' },
      memberships,
      selected,
      context.sessionId,
      csrfHeader,
    );
  }

  public async verifyAccessToken(token: string): Promise<TenantContext> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.environment.JWT_ACCESS_SECRET,
        issuer: this.environment.JWT_ISSUER,
        audience: this.environment.JWT_AUDIENCE,
        algorithms: ['HS256'],
      });
      const active = await this.identity.validateAccessSession(
        payload.sid,
        payload.sub,
        payload.tid,
      );
      if (active === null || payload.pk !== 'user') {
        throw new Error('session is no longer active');
      }
      return {
        tenantId: payload.tid,
        principalId: payload.sub,
        principalKind: payload.pk,
        role:
          active.user.platformRole === 'platform_admin' ? 'platform_admin' : active.membership.role,
        sessionId: payload.sid,
      };
    } catch {
      throw new ApplicationError('AUTHENTICATION_REQUIRED', 'Access token is invalid or expired');
    }
  }

  public async getCurrentSession(context: TenantContext): Promise<CurrentSessionView> {
    if (context.sessionId === undefined || context.principalKind !== 'user') {
      throw new ApplicationError('AUTHENTICATION_REQUIRED', 'User session is required');
    }
    const active = await this.identity.validateAccessSession(
      context.sessionId,
      context.principalId,
      context.tenantId,
    );
    if (active === null) {
      throw new ApplicationError('AUTHENTICATION_REQUIRED', 'Session is no longer active');
    }
    return {
      memberships: await this.identity.listMemberships(context.principalId),
      selectedTenant: active.membership,
      user: {
        id: active.user.id,
        displayName: active.user.displayName,
        email: active.user.email,
        platformRole: active.user.platformRole,
      },
    };
  }

  private async createSession(
    user: LoginUserRecord,
    memberships: readonly Membership[],
    selected: Membership,
    familyId: string,
    csrfToken: string,
  ): Promise<AuthSession> {
    const expiresAt = new Date(Date.now() + this.environment.ACCESS_TOKEN_TTL_SECONDS * 1_000);
    const role = user.platformRole === 'platform_admin' ? 'platform_admin' : selected.role;
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        tid: selected.tenantId,
        role,
        pk: 'user',
        sid: familyId,
        email: user.email,
        platformRole: user.platformRole,
      } satisfies AccessTokenPayload,
      {
        secret: this.environment.JWT_ACCESS_SECRET,
        issuer: this.environment.JWT_ISSUER,
        audience: this.environment.JWT_AUDIENCE,
        algorithm: 'HS256',
        expiresIn: this.environment.ACCESS_TOKEN_TTL_SECONDS,
      },
    );
    return {
      accessToken,
      accessTokenExpiresAt: expiresAt.toISOString(),
      csrfToken,
      memberships: [...memberships],
      selectedTenant: selected,
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        platformRole: user.platformRole,
      },
    };
  }

  private hashCsrf(token: string): string {
    return sha256(token + this.environment.REFRESH_TOKEN_PEPPER);
  }

  private async hashRefreshSecret(secret: string): Promise<string> {
    return hash(secret + this.environment.REFRESH_TOKEN_PEPPER, PASSWORD_HASH_OPTIONS);
  }

  private deriveSuccessorRefreshSecret(rawRefreshToken: string): string {
    return createHmac('sha256', this.environment.REFRESH_TOKEN_PEPPER)
      .update('queueforge-refresh-successor-v1\0', 'utf8')
      .update(rawRefreshToken, 'utf8')
      .digest('base64url');
  }

  private assertDoubleSubmitCsrf(header: string, cookie: string): void {
    if (header.length === 0 || cookie.length === 0 || !safeEqual(header, cookie)) {
      throw new ApplicationError('CSRF_VALIDATION_FAILED', 'CSRF validation failed');
    }
  }

  private async performDummyPasswordVerification(password: string): Promise<boolean> {
    await verify(await this.dummyPasswordHash, password);
    return false;
  }
}
