import { Injectable } from '@nestjs/common';

import type { ApprovalDecisionInput, TenantContext } from '@queueforge/contracts';
import { createIdempotencyFingerprint, sha256Hex } from '@queueforge/domain';
import { ApprovalStore, ReadModelStore } from '@queueforge/persistence';

import { requireAnyRole } from './authorization.js';

@Injectable()
export class ApprovalService {
  public constructor(
    private readonly approvals: ApprovalStore,
    private readonly readModels: ReadModelStore,
  ) {}

  public list(
    context: TenantContext,
    page: number,
    pageSize: number,
  ): ReturnType<ReadModelStore['listApprovals']> {
    requireAnyRole(context, ['approver', 'tenant_admin', 'platform_admin']);
    return this.readModels.listApprovals(context, page, pageSize);
  }

  public decide(
    context: TenantContext,
    approvalId: string,
    correlationId: string,
    input: ApprovalDecisionInput,
    idempotencyKey?: string,
  ): ReturnType<ApprovalStore['decide']> {
    requireAnyRole(context, ['approver', 'tenant_admin', 'platform_admin']);
    return this.approvals.decide(
      context,
      approvalId,
      correlationId,
      input,
      idempotencyKey === undefined
        ? undefined
        : {
            idempotencyKeyHash: sha256Hex(idempotencyKey),
            requestFingerprint: createIdempotencyFingerprint({
              operation: 'approval.decide',
              principalId: context.principalId,
              request: {
                approvalId,
                decision: input.decision,
                expectedRevision: input.expectedRevision,
                note: input.note ?? null,
              },
            }),
          },
    );
  }
}
