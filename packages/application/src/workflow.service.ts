import { Injectable } from '@nestjs/common';

import type { DraftAutosaveInput, JsonObject, TenantContext } from '@queueforge/contracts';
import { createIdempotencyFingerprint, sha256Hex } from '@queueforge/domain';
import { WorkflowStore } from '@queueforge/persistence';

import { requireAnyRole } from './authorization.js';

@Injectable()
export class WorkflowService {
  public constructor(private readonly workflows: WorkflowStore) {}

  public list(context: TenantContext): ReturnType<WorkflowStore['list']> {
    return this.workflows.list(context);
  }

  public get(context: TenantContext, templateId: string): ReturnType<WorkflowStore['get']> {
    return this.workflows.get(context, templateId);
  }

  public create(
    context: TenantContext,
    input: { readonly stableKey: string; readonly name: string; readonly description?: string },
    idempotencyKey: string,
    correlationId: string,
  ): ReturnType<WorkflowStore['create']> {
    requireAnyRole(context, ['tenant_admin', 'platform_admin']);
    const request: JsonObject = {
      stableKey: input.stableKey,
      name: input.name,
      description: input.description ?? null,
    };
    return this.workflows.create(context, {
      stableKey: input.stableKey,
      name: input.name,
      description: input.description ?? null,
      correlationId,
      idempotencyKeyHash: sha256Hex(idempotencyKey),
      requestFingerprint: createIdempotencyFingerprint({
        operation: 'workflow.create',
        principalId: context.principalId,
        request,
      }),
    });
  }

  public getDraft(
    context: TenantContext,
    templateId: string,
  ): ReturnType<WorkflowStore['getOrCreateDraft']> {
    requireAnyRole(context, ['tenant_admin', 'platform_admin']);
    return this.workflows.getOrCreateDraft(context, templateId, context.principalId);
  }

  public cloneDraft(
    context: TenantContext,
    templateId: string,
  ): ReturnType<WorkflowStore['getOrCreateDraft']> {
    requireAnyRole(context, ['tenant_admin', 'platform_admin']);
    return this.workflows.getOrCreateDraft(context, templateId, context.principalId);
  }

  public saveDraft(
    context: TenantContext,
    templateId: string,
    correlationId: string,
    input: DraftAutosaveInput,
  ): ReturnType<WorkflowStore['saveDraft']> {
    requireAnyRole(context, ['tenant_admin', 'platform_admin']);
    return this.workflows.saveDraft(context, templateId, context.principalId, correlationId, input);
  }

  public activate(
    context: TenantContext,
    templateId: string,
    correlationId: string,
  ): ReturnType<WorkflowStore['activateDraft']> {
    requireAnyRole(context, ['tenant_admin', 'platform_admin']);
    return this.workflows.activateDraft(context, templateId, context.principalId, correlationId);
  }
}
