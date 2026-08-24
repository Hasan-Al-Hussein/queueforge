# ADR 0002: Split REST commands from composite GraphQL reads

- **Status:** Accepted
- **Date:** 2026-08-24
- **Decision owners:** QueueForge architecture review

## Context

QueueForge must demonstrate both REST and GraphQL without creating two competing business layers. Its external operations require explicit HTTP semantics: idempotency headers, webhook signatures, status codes, replay controls, stable pagination, and OpenAPI documentation. Its dashboard benefits from composite views that would otherwise require several REST round trips.

A transport split is useful only if both surfaces share authorization, tenant isolation, transactions, and domain rules.

## Decision

Use versioned REST under `/api/v1` for commands and operational resources. Use GraphQL at `/graphql` for composite dashboard and request reads, plus `submitWorkflowRequest` and `decideApproval` mutations. Both transports call the same application services and persistence ports.

| Capability                                               | REST                                | GraphQL                                    |
| -------------------------------------------------------- | ----------------------------------- | ------------------------------------------ |
| Authentication and session lifecycle                     | Primary                             | Not duplicated                             |
| Workflow draft, autosave, activation, and administration | Primary                             | Catalog read only                          |
| Request submit, list, detail, cancel, retry              | Primary                             | Submit mutation and composite detail reads |
| Approval list and decision                               | Primary                             | Decision mutation shares application path  |
| Inbound and outbound webhooks                            | Primary                             | Not exposed                                |
| Delivery replay and dead-letter operations               | Primary                             | Read composition only                      |
| Tenant, membership, API-client, and audit administration | Primary                             | Selected dashboard/read composition        |
| Dashboard overview and correlated timeline               | Available as resources where useful | Primary composite view                     |
| Subscriptions                                            | Not applicable                      | Excluded                                   |

The implemented GraphQL operation set is `dashboardOverview`, `workflows`, `workflowRequests`, `requestDetail`, `submitWorkflowRequest`, and `decideApproval`. `requestDetail` includes the transition timeline and optional approval composition. GraphQL does not receive second command implementations; both mutations invoke the same application services as REST.

## Shared invariants

- Tenant identity comes from a validated session membership, authorized platform tenant selection, or hashed API key. A body field is never trusted as tenant authority.
- Every controller and resolver constructs or receives a non-optional `TenantContext` before invoking an application service.
- Deny-by-default RBAC, self-approval policy, workflow immutability, state transitions, idempotency, audit, and outbox rules are transport-independent.
- Correlation identifiers propagate through both transports into the same transaction, outbox, queue, worker, webhook, notification, and audit path.
- Errors never include stacks or secrets. REST uses the shared error envelope. GraphQL application/resolver failures use the same mapping, and an Apollo error-envelope plugin normalizes every remaining failure to a bounded public code with request and correlation identifiers.

## REST contract

REST owns commands because HTTP makes their operational semantics visible:

- `Idempotency-Key` is required where a repeated command could repeat an effect;
- standard response status and resource identity can distinguish creation, replay, conflict, and validation failure;
- webhook endpoints can verify HMAC over the unparsed request body;
- stable page/pageSize pagination, validated supported filters, and fixed server ordering are documented in OpenAPI;
- retry, replay, cancellation, and dead-letter actions remain auditable resources rather than generic graph mutations.

The default REST JSON body limit is 256 KiB. Inbound webhook payloads have a separately configured cap of no more than 1 MiB.

## GraphQL contract

GraphQL exists to compose operator-facing reads, not to bypass transport constraints. The server enforces:

- request body limit: 256 KiB;
- maximum depth: 8;
- maximum calculated complexity: 200;
- maximum aliases: 20;
- maximum page size: 100;
- introspection disabled in production;
- batched/scoped loading or equivalent query discipline to prevent N+1 access patterns.

No subscriptions are planned. This avoids another stateful process path and is appropriate for the laptop resource budget; the dashboard may use bounded polling for operational freshness.

## Consequences

### Benefits

- REST preserves explicit command, signature, retry, and status semantics.
- GraphQL can return dashboard and timeline projections in one bounded request.
- A single application layer prevents business-rule and audit drift between transports.
- The split makes REST and GraphQL meaningfully non-duplicative in portfolio evidence.

### Costs and risks

- Schema and OpenAPI contracts both require compatibility tests.
- Authorization must be tested at both transport adapters even though policy lives below them.
- GraphQL mutations can create ambiguity unless idempotency, authorization, revision, and error behavior are demonstrably identical to REST.
- Composite resolvers can cause N+1 queries or tenant inference if loaders are not tenant-scoped.

## Validation gates

- REST and GraphQL submissions with the same authorized principal, operation, payload, and idempotency key resolve to one request and one outbox effect.
- REST and GraphQL approval decisions enforce the same revision, self-approval, role, and idempotency rules.
- Cross-tenant identifiers are denied without revealing whether the other tenant's object exists.
- RBAC decisions match across controllers and resolvers.
- Depth, complexity, alias, body-size, and page-size limits fail closed.
- Contract snapshots cover OpenAPI, GraphQL schema, shared error codes, and pagination.
- Query-count assertions demonstrate bounded dashboard and timeline resolution.

If those gates cannot be met through shared application services, the GraphQL mutations must be removed rather than maintained as divergent business logic; such a change requires explicit architecture review.
