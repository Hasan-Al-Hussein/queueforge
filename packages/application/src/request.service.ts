import { Injectable } from '@nestjs/common';

import type {
  RequestSource,
  SubmitWorkflowRequest,
  TenantContext,
  WorkflowRequestView,
  WorkflowRequestStatus,
} from '@queueforge/contracts';
import { createIdempotencyFingerprint, hashJson, sha256Hex } from '@queueforge/domain';
import {
  ReadModelStore,
  RequestSubmissionStore,
  type PageResult,
  type SubmitRequestStoreResult,
} from '@queueforge/persistence';

import { requireAnyRole } from './authorization.js';

@Injectable()
export class RequestService {
  public constructor(
    private readonly submissions: RequestSubmissionStore,
    private readonly readModels: ReadModelStore,
  ) {}

  public async submit(
    context: TenantContext,
    input: SubmitWorkflowRequest,
    idempotencyKey: string,
    correlationId: string,
    source: RequestSource,
  ): Promise<SubmitRequestStoreResult> {
    requireAnyRole(context, ['operator', 'tenant_admin', 'platform_admin']);
    return this.submissions.submit({
      context,
      workflowKey: input.workflowKey,
      payload: input.payload,
      payloadHash: hashJson(input.payload),
      source,
      correlationId,
      endpointScope: 'requests:submit',
      idempotencyKeyHash: sha256Hex(idempotencyKey),
      requestFingerprint: createIdempotencyFingerprint({
        operation: 'workflow-request.submit',
        principalId: context.principalId,
        request: input,
      }),
    });
  }

  public list(
    context: TenantContext,
    page: number,
    pageSize: number,
    status?: WorkflowRequestStatus,
    search?: string,
    sortBy?: 'attemptCount' | 'source' | 'status' | 'submittedAt' | 'workflowName',
    sortDirection?: 'asc' | 'desc',
  ): Promise<PageResult<WorkflowRequestView>> {
    return this.readModels.listRequests(
      context,
      page,
      pageSize,
      status,
      search,
      sortBy,
      sortDirection,
    );
  }

  public timeline(
    context: TenantContext,
    requestId: string,
  ): ReturnType<ReadModelStore['requestTimeline']> {
    return this.readModels.requestTimeline(context, requestId);
  }

  public get(context: TenantContext, requestId: string): ReturnType<ReadModelStore['getRequest']> {
    return this.readModels.getRequest(context, requestId);
  }

  public detail(
    context: TenantContext,
    requestId: string,
  ): ReturnType<ReadModelStore['requestDetail']> {
    return this.readModels.requestDetail(context, requestId);
  }
}
