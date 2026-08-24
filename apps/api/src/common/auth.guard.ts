import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ApiClientService, ApplicationError, AuthService } from '@queueforge/application';

import { PUBLIC_ROUTE, requestFromContext } from './http-context.js';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly apiClients: ApiClientService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) {
      return true;
    }
    const request = requestFromContext(context);
    const authorization = request.header('authorization');
    if (authorization === undefined) {
      throw new ApplicationError(
        'AUTHENTICATION_REQUIRED',
        'Bearer access token or API key is required',
      );
    }
    const bearer = /^Bearer\s+(.+)$/iu.exec(authorization);
    if (bearer !== null) {
      const token = bearer[1]?.trim() ?? '';
      if (token.length === 0) {
        throw new ApplicationError('AUTHENTICATION_REQUIRED', 'Bearer access token is required');
      }
      request.tenantContext = await this.auth.verifyAccessToken(token);
      return true;
    }
    const apiKey = /^ApiKey\s+(.+)$/iu.exec(authorization);
    if (apiKey !== null) {
      const credential = apiKey[1]?.trim() ?? '';
      if (credential.length === 0) {
        throw new ApplicationError('AUTHENTICATION_REQUIRED', 'API key is required');
      }
      request.tenantContext = await this.apiClients.verify(credential);
      return true;
    }
    throw new ApplicationError(
      'AUTHENTICATION_REQUIRED',
      'Bearer access token or API key is required',
    );
  }
}
