# ADR 0001: Use TypeORM with explicit PostgreSQL migrations

- **Status:** Accepted for implementation
- **Date:** 2026-08-24
- **Decision owners:** QueueForge architecture review

## Context

QueueForge's central correctness claims depend on PostgreSQL behavior, not on ordinary record creation alone. The implementation needs:

- tenant-safe composite foreign keys;
- partial and expression indexes;
- append-only triggers and runtime grants;
- transaction-scoped row locks for approvals, refresh rotation, and idempotency;
- atomic outbox claiming with `FOR UPDATE SKIP LOCKED`;
- conditional lease updates and PostgreSQL-specific query plans;
- reviewed, reversible SQL migrations with `synchronize: false`.

Prisma and TypeORM were compared for a NestJS modular monolith. Prisma offers excellent generated types and a polished query API. However, the operations above would require repeated raw-SQL escape hatches and extra care around tenant-scoping behavior. TypeORM integrates directly with NestJS and exposes the locking and migration mechanisms that dominate this project's risk.

## Decision

Use TypeORM 1.1.0 with `@nestjs/typeorm` 11.0.3 and PostgreSQL. Schema changes are delivered as explicit migrations, including raw SQL where PostgreSQL features require it. Schema synchronization is disabled in every environment.

Persistence remains behind application-facing adapters:

- entities, query builders, and generic repositories stay inside `packages/persistence`;
- application services receive tenant-scoped interfaces rather than unrestricted repositories;
- every tenant-owned table uses `tenant_id NOT NULL`, tenant-leading indexes, and composite tenant foreign keys;
- all tenant reads and writes require a non-optional validated tenant context;
- migrations run under an owner distinct from the runtime database role.

The database constraints complement application scoping. QueueForge does not claim PostgreSQL row-level security.

## Consequences

### Benefits

- PostgreSQL locking and `SKIP LOCKED` are expressible without disguising the critical transaction boundaries.
- Composite foreign keys, triggers, partial indexes, and grants can be reviewed in the same migrations that install them.
- NestJS dependency injection can bind concrete adapters cleanly while keeping ORM types out of domain and transport packages.
- The outbox lease algorithm and query plans can be tested against real PostgreSQL rather than an in-memory substitute.

### Costs and risks

- TypeORM's entity model provides weaker end-to-end generated typing than Prisma's client.
- Query-builder and raw-SQL code require focused review and parameterization.
- Migration authors must maintain valid `down` paths where PostgreSQL permits them.
- Tenant scoping is not automatically inferred; adapter APIs and database constraints must enforce it deliberately.
- Unit tests cannot substitute for migration, constraint, locking, and query-plan integration tests.

## Required controls

1. Set `synchronize: false` in development, test, and demonstration configurations.
2. Use parameter binding for all untrusted values; never concatenate identifiers or filters from requests.
3. Do not export unrestricted `Repository<Entity>` instances from persistence adapters.
4. Use composite keys and foreign keys so a child row cannot reference another tenant's parent.
5. Protect append-only history tables with triggers and runtime-role `REVOKE UPDATE, DELETE, TRUNCATE`.
6. Keep domain state, transition history, sanitized audit data, idempotency result, and outbox insertion in one database transaction.
7. Verify tenant-leading and partial indexes with representative `EXPLAIN` assertions.

## Validation gates

This decision remains valid only if integration tests prove:

- migration up/down/up behavior;
- rejection of a cross-tenant composite relationship;
- immutable active workflow content and append-only history;
- approval and refresh-token race serialization;
- concurrent idempotency serialization;
- two dispatchers can claim different outbox rows with `SKIP LOCKED`;
- an expired outbox lease is reclaimable without losing committed work.

If TypeORM cannot express or safely execute those probes, the architecture must be reconsidered before transports are promoted. Passing ordinary CRUD tests is not sufficient.

## Alternatives considered

### Prisma

Rejected for this implementation because the project's highest-risk operations are PostgreSQL-specific and would repeatedly cross into raw SQL. Prisma remains a reasonable choice for systems dominated by generated CRUD and simpler transaction patterns.

### Hand-written SQL throughout

Rejected because it would increase mapping and maintenance work for ordinary entities without improving the critical migrations and lock queries. Targeted SQL inside a constrained persistence package gives the needed database control with less duplication.

### PostgreSQL row-level security

Not adopted in the current local portfolio scope. Composite tenant constraints and mandatory tenant-scoped adapters are the chosen controls. Documentation and career claims must not imply that RLS exists.
