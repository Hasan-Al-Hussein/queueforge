import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ApiClientService, ApplicationError, AuthService } from '@queueforge/application';

import { PUBLIC_ROUTE, requestFromContext } from './http-context.js';

const AUTHORIZATION_HEADER_MAX_LENGTH = 8_192;

type AuthorizationCredential = Readonly<{
  kind: 'apiKey' | 'bearer';
  value: string;
}>;

function parseAuthorizationHeader(value: string): AuthorizationCredential | null {
  if (value.length === 0 || value.length > AUTHORIZATION_HEADER_MAX_LENGTH) {
    return null;
  }

  const separatorIndex = value.indexOf(' ');
  if (separatorIndex <= 0) {
    return null;
  }

  let credentialStart = separatorIndex;
  while (credentialStart < value.length && value.charCodeAt(credentialStart) === 0x20) {
    credentialStart += 1;
  }
  if (credentialStart === value.length) {
    return null;
  }

  for (let index = credentialStart; index < value.length; index += 1) {
    const character = value.charCodeAt(index);
    if (character <= 0x20 || character === 0x7f) {
      return null;
    }
  }

  const scheme = value.slice(0, separatorIndex).toLowerCase();
  const credential = value.slice(credentialStart);
  if (scheme === 'bearer') {
    return { kind: 'bearer', value: credential };
  }
  if (scheme === 'apikey') {
    return { kind: 'apiKey', value: credential };
  }
  return null;
}

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
    const credential = parseAuthorizationHeader(authorization);
    if (credential === null) {
      throw new ApplicationError(
        'AUTHENTICATION_REQUIRED',
        'Bearer access token or API key is required',
      );
    }
    const verifiers: Record<
      AuthorizationCredential['kind'],
      (value: string) => ReturnType<ApiClientService['verify']>
    > = {
      apiKey: (value) => this.apiClients.verify(value),
      bearer: (value) => this.auth.verifyAccessToken(value),
    };
    request.tenantContext = await verifiers[credential.kind](credential.value);
    return true;
  }
}
