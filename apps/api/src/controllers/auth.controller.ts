import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Response } from 'express';

import {
  AuthService,
  RUNTIME_ENVIRONMENT,
  type AuthRequestMetadata,
  type CurrentSessionView,
} from '@queueforge/application';
import type { RuntimeEnvironment } from '@queueforge/config';
import { LoginRequestSchema } from '@queueforge/contracts';
import type { AuthSession, LoginRequest, TenantContext } from '@queueforge/contracts';

import {
  CurrentTenant,
  Public,
  RequestCorrelationId,
  type QueueForgeRequest,
} from '../common/http-context.js';
import { assertTrustedOrigin, requireHeader, sourceIp } from '../common/request-values.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SelectTenantDto } from '../dto.js';
import {
  ApiCsrfToken,
  ApiJsonBody,
  ApiQueueForgeJsonResponse,
  ApiQueueForgeNoContentResponse,
  ApiTrustedOrigin,
} from '../openapi/decorators.js';
import {
  AUTH_SESSION_SCHEMA,
  CURRENT_SESSION_SCHEMA,
  LOGIN_BODY_SCHEMA,
} from '../openapi/schemas.js';

const AUTH_RATE_LIMIT = { default: { limit: 10, ttl: 60_000 } } as const;

@ApiTags('authentication')
@Controller('auth')
export class AuthController {
  public constructor(
    private readonly auth: AuthService,
    @Inject(RUNTIME_ENVIRONMENT) private readonly environment: RuntimeEnvironment,
  ) {}

  @Public()
  @Throttle(AUTH_RATE_LIMIT)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate a user and create a rotating refresh family' })
  @ApiJsonBody(LOGIN_BODY_SCHEMA, 'Local user credentials and optional initial tenant selection.')
  @ApiTrustedOrigin()
  @ApiQueueForgeJsonResponse({
    description: 'Authenticated session. Refresh and CSRF cookies are also set.',
    schema: AUTH_SESSION_SCHEMA,
  })
  public async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) input: LoginRequest,
    @Req() request: QueueForgeRequest,
    @Res({ passthrough: true }) response: Response,
    @RequestCorrelationId() correlationId: string,
  ): Promise<AuthSession> {
    assertTrustedOrigin(request.header('origin'), this.environment.WEB_ORIGIN);
    const result = await this.auth.login(input, this.metadata(request, correlationId));
    this.setAuthCookies(
      response,
      result.refreshToken,
      result.session.csrfToken,
      result.refreshExpiresAt,
    );
    return result.session;
  }

  @Public()
  @Throttle(AUTH_RATE_LIMIT)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token and issue a short-lived access token' })
  @ApiCookieAuth('refreshCookie')
  @ApiCsrfToken()
  @ApiTrustedOrigin()
  @ApiQueueForgeJsonResponse({
    description: 'Rotated session. Replacement refresh and CSRF cookies are also set.',
    schema: AUTH_SESSION_SCHEMA,
  })
  public async refresh(
    @Req() request: QueueForgeRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers('x-csrf-token') csrfHeader: string | undefined,
    @RequestCorrelationId() correlationId: string,
  ): Promise<AuthSession> {
    assertTrustedOrigin(request.header('origin'), this.environment.WEB_ORIGIN);
    const refreshToken = this.cookie(request, this.environment.REFRESH_COOKIE_NAME);
    const csrfCookie = this.cookie(request, this.environment.CSRF_COOKIE_NAME);
    const result = await this.auth.refresh(
      requireHeader(refreshToken, this.environment.REFRESH_COOKIE_NAME),
      requireHeader(csrfHeader, 'X-CSRF-Token'),
      requireHeader(csrfCookie, this.environment.CSRF_COOKIE_NAME),
      this.metadata(request, correlationId),
    );
    this.setAuthCookies(
      response,
      result.refreshToken,
      result.session.csrfToken,
      result.refreshExpiresAt,
    );
    return result.session;
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the active refresh-token family' })
  @ApiCsrfToken()
  @ApiTrustedOrigin()
  @ApiQueueForgeNoContentResponse('The refresh-token family was revoked and cookies cleared.')
  public async logout(
    @CurrentTenant() context: TenantContext,
    @Req() request: QueueForgeRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers('x-csrf-token') csrfHeader: string | undefined,
    @RequestCorrelationId() correlationId: string,
  ): Promise<void> {
    assertTrustedOrigin(request.header('origin'), this.environment.WEB_ORIGIN);
    await this.auth.logout(
      context,
      requireHeader(csrfHeader, 'X-CSRF-Token'),
      requireHeader(
        this.cookie(request, this.environment.CSRF_COOKIE_NAME),
        this.environment.CSRF_COOKIE_NAME,
      ),
      this.metadata(request, correlationId),
    );
    response.clearCookie(this.environment.REFRESH_COOKIE_NAME, this.refreshCookieOptions());
    response.clearCookie(this.environment.CSRF_COOKIE_NAME, this.csrfCookieOptions());
  }

  @ApiBearerAuth()
  @Post('tenant-select')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Switch the selected tenant within the active session' })
  @ApiBody({ type: SelectTenantDto })
  @ApiCsrfToken()
  @ApiTrustedOrigin()
  @ApiQueueForgeJsonResponse({
    description: 'Updated access token and tenant-scoped session.',
    schema: AUTH_SESSION_SCHEMA,
  })
  public selectTenant(
    @CurrentTenant() context: TenantContext,
    @Body() input: SelectTenantDto,
    @Req() request: QueueForgeRequest,
    @Headers('x-csrf-token') csrfHeader: string | undefined,
    @RequestCorrelationId() correlationId: string,
  ): Promise<AuthSession> {
    assertTrustedOrigin(request.header('origin'), this.environment.WEB_ORIGIN);
    return this.auth.selectTenant(
      context,
      input.tenantId,
      requireHeader(csrfHeader, 'X-CSRF-Token'),
      requireHeader(
        this.cookie(request, this.environment.CSRF_COOKIE_NAME),
        this.environment.CSRF_COOKIE_NAME,
      ),
      this.metadata(request, correlationId),
    );
  }

  private metadata(request: QueueForgeRequest, correlationId: string): AuthRequestMetadata {
    return {
      correlationId,
      sourceIp: sourceIp(request.ip),
      userAgent: request.header('user-agent')?.slice(0, 1_000) ?? null,
    };
  }

  private cookie(request: QueueForgeRequest, name: string): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[name];
    return typeof value === 'string' ? value : undefined;
  }

  private setAuthCookies(
    response: Response,
    refreshToken: string,
    csrfToken: string,
    expires: Date,
  ): void {
    response.cookie(this.environment.REFRESH_COOKIE_NAME, refreshToken, {
      ...this.refreshCookieOptions(),
      expires,
    });
    response.cookie(this.environment.CSRF_COOKIE_NAME, csrfToken, {
      ...this.csrfCookieOptions(),
      expires,
    });
  }

  private refreshCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      path: '/api/v1/auth',
      sameSite: 'lax' as const,
      secure: this.environment.COOKIE_SECURE,
    };
  }

  private csrfCookieOptions(): CookieOptions {
    return {
      httpOnly: false,
      path: '/',
      sameSite: 'lax' as const,
      secure: this.environment.COOKIE_SECURE,
    };
  }
}

@ApiTags('session')
@ApiBearerAuth()
@Controller('session')
export class SessionController {
  public constructor(private readonly auth: AuthService) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get the authenticated user and active tenant membership' })
  @ApiQueueForgeJsonResponse({
    description: 'The authenticated user and their active tenant memberships.',
    schema: CURRENT_SESSION_SCHEMA,
  })
  public current(@CurrentTenant() context: TenantContext): Promise<CurrentSessionView> {
    return this.auth.getCurrentSession(context);
  }
}
