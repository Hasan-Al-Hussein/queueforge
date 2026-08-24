import { createHmac } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { argon2id, hash } from 'argon2';

import type { JsonObject, TenantContext, TenantRole } from '@queueforge/contracts';
import { createIdempotencyFingerprint, sha256Hex } from '@queueforge/domain';
import { AdminStore } from '@queueforge/persistence';

import { requireAnyRole } from './authorization.js';
import { RUNTIME_ENVIRONMENT } from './configuration.js';
import type { RuntimeEnvironment } from '@queueforge/config';

const PASSWORD_HASH_OPTIONS = Object.freeze({
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

export interface CreateTenantCommand {
  readonly name: string;
  readonly slug: string;
}

export interface CreateMembershipCommand {
  readonly email: string;
  readonly role: TenantRole;
  readonly displayName?: string;
  readonly initialPassword?: string;
}

@Injectable()
export class AdminService {
  public constructor(
    private readonly admins: AdminStore,
    @Inject(RUNTIME_ENVIRONMENT) private readonly environment: RuntimeEnvironment,
  ) {}

  public createTenant(
    context: TenantContext,
    command: CreateTenantCommand,
    idempotencyKey: string,
    correlationId: string,
  ): ReturnType<AdminStore['createTenant']> {
    requireAnyRole(context, ['platform_admin']);
    const request: JsonObject = { name: command.name, slug: command.slug };
    return this.admins.createTenant(context, {
      ...command,
      correlationId,
      idempotencyKeyHash: sha256Hex(idempotencyKey),
      requestFingerprint: createIdempotencyFingerprint({
        operation: 'tenant.create',
        principalId: context.principalId,
        request,
      }),
    });
  }

  public async createMembership(
    context: TenantContext,
    command: CreateMembershipCommand,
    idempotencyKey: string,
    correlationId: string,
  ): ReturnType<AdminStore['createMembership']> {
    requireAnyRole(context, ['tenant_admin', 'platform_admin']);
    const request: JsonObject = {
      email: command.email,
      role: command.role,
      displayName: command.displayName ?? null,
      initialPasswordBinding:
        command.initialPassword === undefined
          ? null
          : createHmac('sha256', this.environment.REFRESH_TOKEN_PEPPER)
              .update(command.initialPassword, 'utf8')
              .digest('hex'),
    };
    const passwordHash =
      command.initialPassword !== undefined
        ? await hash(command.initialPassword, PASSWORD_HASH_OPTIONS)
        : undefined;
    return this.admins.createMembership(context, {
      email: command.email,
      role: command.role,
      displayName: command.displayName,
      passwordHash,
      correlationId,
      idempotencyKeyHash: sha256Hex(idempotencyKey),
      requestFingerprint: createIdempotencyFingerprint({
        operation: 'membership.create',
        principalId: context.principalId,
        request,
      }),
    });
  }
}
