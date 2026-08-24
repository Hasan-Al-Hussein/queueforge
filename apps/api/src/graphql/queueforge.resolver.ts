import { Args, Field, ID, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { GraphQLError, GraphQLScalarType, Kind, valueFromASTUntyped } from 'graphql';

import {
  ApplicationError,
  ApprovalService,
  OperationsService,
  RequestService,
  WorkflowService,
} from '@queueforge/application';
import {
  ApprovalDecisionInputSchema,
  SubmitWorkflowRequestSchema,
  UuidSchema,
  WorkflowRequestStatusSchema,
} from '@queueforge/contracts';
import type {
  JsonObject,
  TenantContext,
  WorkflowRequestStatus,
  WorkflowRequestView,
} from '@queueforge/contracts';

import { CurrentTenant, RequestCorrelationId } from '../common/http-context.js';
import { requireIdempotencyKey } from '../common/request-values.js';

const JsonGraphqlScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'A JSON object',
  parseLiteral(node) {
    if (node.kind !== Kind.OBJECT) {
      throw new GraphQLError('JSON input must be an object');
    }
    return valueFromASTUntyped(node);
  },
  parseValue(value: unknown) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new GraphQLError('JSON input must be an object');
    }
    return value;
  },
  serialize(value: unknown) {
    return value;
  },
});

@ObjectType('Workflow')
class WorkflowGraphql {
  @Field(() => ID)
  public id!: string;

  @Field()
  public stableKey!: string;

  @Field()
  public name!: string;

  @Field(() => String, { nullable: true })
  public description!: string | null;

  @Field(() => ID)
  public versionId!: string;

  @Field(() => Int)
  public versionNo!: number;

  @Field()
  public versionStatus!: string;

  @Field()
  public requiresApproval!: boolean;

  @Field()
  public isEnabled!: boolean;

  @Field(() => Int)
  public revision!: number;

  @Field()
  public updatedAt!: string;
}

@ObjectType('WorkflowRequest')
class WorkflowRequestGraphql {
  @Field(() => ID)
  public id!: string;

  @Field(() => ID)
  public workflowId!: string;

  @Field(() => ID)
  public workflowVersionId!: string;

  @Field()
  public workflowName!: string;

  @Field(() => Int)
  public versionNo!: number;

  @Field()
  public status!: string;

  @Field()
  public source!: string;

  @Field(() => JsonGraphqlScalar)
  public payload!: JsonObject;

  @Field(() => ID)
  public correlationId!: string;

  @Field()
  public submittedAt!: string;

  @Field()
  public statusChangedAt!: string;

  @Field(() => Int)
  public attemptCount!: number;

  @Field(() => Int)
  public maxAttempts!: number;
}

@ObjectType('RequestStatusCount')
class RequestStatusCountGraphql {
  @Field()
  public status!: string;

  @Field(() => Int)
  public count!: number;
}

@ObjectType('QueueOverview')
class QueueOverviewGraphql {
  @Field()
  public name!: string;

  @Field(() => Int)
  public waiting!: number;

  @Field(() => Int)
  public active!: number;

  @Field(() => Int)
  public delayed!: number;

  @Field(() => Int)
  public failed!: number;
}

@ObjectType('ThroughputBucket')
class ThroughputBucketGraphql {
  @Field()
  public bucket!: string;

  @Field(() => Int)
  public succeeded!: number;

  @Field(() => Int)
  public failed!: number;
}

@ObjectType('DashboardOverview')
class DashboardOverviewGraphql {
  @Field(() => [RequestStatusCountGraphql])
  public statusCounts!: RequestStatusCountGraphql[];

  @Field(() => [QueueOverviewGraphql])
  public queues!: QueueOverviewGraphql[];

  @Field(() => [WorkflowRequestGraphql])
  public recentRequests!: WorkflowRequestGraphql[];

  @Field(() => [ThroughputBucketGraphql])
  public throughput!: ThroughputBucketGraphql[];
}

@ObjectType('RequestTransition')
class RequestTransitionGraphql {
  @Field(() => ID)
  public id!: string;

  @Field(() => String, { nullable: true })
  public fromStatus?: string | null;

  @Field()
  public toStatus!: string;

  @Field(() => String, { nullable: true })
  public reason?: string | null;

  @Field(() => String, { nullable: true })
  public actorName?: string | null;

  @Field()
  public occurredAt!: string;
}

@ObjectType('RequestApproval')
class RequestApprovalGraphql {
  @Field(() => ID)
  public id!: string;

  @Field()
  public status!: string;

  @Field()
  public requestedBy!: string;

  @Field(() => String, { nullable: true })
  public decidedBy!: string | null;

  @Field(() => String, { nullable: true })
  public note!: string | null;

  @Field(() => Int)
  public revision!: number;
}

@ObjectType('RequestDetail')
class RequestDetailGraphql {
  @Field(() => WorkflowRequestGraphql)
  public request!: WorkflowRequestGraphql;

  @Field(() => [RequestTransitionGraphql])
  public transitions!: RequestTransitionGraphql[];

  @Field(() => RequestApprovalGraphql, { nullable: true })
  public approval!: RequestApprovalGraphql | null;
}

@ObjectType('ApprovalDecision')
class ApprovalDecisionGraphql {
  @Field(() => ID)
  public approvalId!: string;

  @Field(() => ID)
  public requestId!: string;

  @Field()
  public decision!: string;

  @Field()
  public requestStatus!: string;

  @Field()
  public replayed!: boolean;
}

@Resolver()
export class QueueForgeResolver {
  public constructor(
    private readonly requests: RequestService,
    private readonly workflows: WorkflowService,
    private readonly approvals: ApprovalService,
    private readonly operations: OperationsService,
  ) {}

  @Query(() => DashboardOverviewGraphql, { name: 'dashboardOverview' })
  public async dashboard(
    @CurrentTenant() context: TenantContext,
  ): Promise<DashboardOverviewGraphql> {
    return (await this.operations.dashboard(context)) as unknown as DashboardOverviewGraphql;
  }

  @Query(() => [WorkflowGraphql], { name: 'workflows' })
  public workflowsList(
    @CurrentTenant() context: TenantContext,
  ): ReturnType<WorkflowService['list']> {
    return this.workflows.list(context);
  }

  @Query(() => [WorkflowRequestGraphql], { name: 'workflowRequests' })
  public async requestList(
    @CurrentTenant() context: TenantContext,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('pageSize', { type: () => Int, defaultValue: 50 }) pageSize: number,
    @Args('status', { type: () => String, nullable: true }) rawStatus?: string,
  ): Promise<readonly WorkflowRequestView[]> {
    if (page < 1 || pageSize < 1 || pageSize > 100) {
      throw new ApplicationError('VALIDATION_FAILED', 'GraphQL pagination is invalid');
    }
    let status: WorkflowRequestStatus | undefined;
    if (rawStatus !== undefined) {
      const parsed = WorkflowRequestStatusSchema.safeParse(rawStatus);
      if (!parsed.success) {
        throw new ApplicationError('VALIDATION_FAILED', 'Unknown request status filter');
      }
      status = parsed.data;
    }
    return (await this.requests.list(context, page, pageSize, status)).items;
  }

  @Query(() => RequestDetailGraphql, { name: 'requestDetail' })
  public requestDetail(
    @CurrentTenant() context: TenantContext,
    @Args('id', { type: () => ID }) requestId: string,
  ): ReturnType<RequestService['detail']> {
    const parsedId = UuidSchema.safeParse(requestId);
    if (!parsedId.success) {
      throw new ApplicationError('VALIDATION_FAILED', 'Request identifier is invalid');
    }
    return this.requests.detail(context, parsedId.data);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Mutation(() => WorkflowRequestGraphql, { name: 'submitWorkflowRequest' })
  public async submit(
    @CurrentTenant() context: TenantContext,
    @Args('workflowKey') workflowKey: string,
    @Args('payload', { type: () => JsonGraphqlScalar }) payload: JsonObject,
    @Args('idempotencyKey') idempotencyKey: string,
    @RequestCorrelationId() correlationId: string,
  ): Promise<WorkflowRequestView> {
    const command = SubmitWorkflowRequestSchema.safeParse({ workflowKey, payload });
    if (!command.success) {
      throw new ApplicationError('VALIDATION_FAILED', 'Workflow request is invalid', {
        issues: command.error.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          path: issue.path.map(String),
        })),
      });
    }
    const result = await this.requests.submit(
      context,
      command.data,
      requireIdempotencyKey(idempotencyKey),
      correlationId,
      'graphql',
    );
    if (result.statusCode === 422) {
      throw new ApplicationError('VALIDATION_FAILED', 'Workflow payload validation failed', {
        validationErrors: result.body.validationErrors,
      });
    }
    const request = result.body.request;
    if (
      request === undefined ||
      request === null ||
      typeof request !== 'object' ||
      Array.isArray(request)
    ) {
      throw new ApplicationError('INTERNAL_ERROR', 'Stored request response is invalid');
    }
    return request as WorkflowRequestView;
  }

  @Mutation(() => ApprovalDecisionGraphql, { name: 'decideApproval' })
  public decideApproval(
    @CurrentTenant() context: TenantContext,
    @Args('approvalId', { type: () => ID }) approvalId: string,
    @Args('decision') decision: string,
    @Args('expectedRevision', { type: () => Int }) expectedRevision: number,
    @Args('note', { type: () => String, nullable: true }) note: string | undefined,
    @Args('idempotencyKey') idempotencyKey: string,
    @RequestCorrelationId() correlationId: string,
  ): ReturnType<ApprovalService['decide']> {
    const parsedId = UuidSchema.safeParse(approvalId);
    const command = ApprovalDecisionInputSchema.safeParse({
      decision,
      expectedRevision,
      ...(note === undefined ? {} : { note }),
    });
    if (!parsedId.success || !command.success) {
      throw new ApplicationError('VALIDATION_FAILED', 'Approval decision is invalid');
    }
    return this.approvals.decide(
      context,
      parsedId.data,
      correlationId,
      command.data,
      requireIdempotencyKey(idempotencyKey),
    );
  }
}
