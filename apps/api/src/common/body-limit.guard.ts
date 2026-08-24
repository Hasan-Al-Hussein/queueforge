import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { ApplicationError } from '@queueforge/application';

import { requestFromContext } from './http-context.js';

const API_BODY_LIMIT_BYTES = 256 * 1_024;
const INBOUND_BODY_LIMIT_BYTES = 1_024 * 1_024;

@Injectable()
export class BodyLimitGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const request = requestFromContext(context);
    const inbound = request.path.startsWith('/api/v1/inbound/webhooks/');
    const limit = inbound ? INBOUND_BODY_LIMIT_BYTES : API_BODY_LIMIT_BYTES;
    if ((request.rawBody?.length ?? 0) > limit) {
      throw new ApplicationError('PAYLOAD_TOO_LARGE', 'Request body is too large', {
        limitBytes: limit,
      });
    }
    return true;
  }
}
