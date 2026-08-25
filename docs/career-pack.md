# QueueForge career pack

## Thirty-second project pitch

QueueForge is a local-first, multi-tenant workflow automation system built to make asynchronous correctness visible. A NestJS REST/GraphQL API commits workflow state, approval decisions, idempotency, audit history, and a PostgreSQL outbox atomically; a BullMQ worker processes queued requests, notifications, and allowlisted signed webhooks with durable receipts and recovery. A static-export Next.js dashboard gives operators a correlated view of queues, attempts, dead letters, and tenant-scoped administration.

The project intentionally does not claim public-cloud readiness, exactly-once HTTP delivery, PostgreSQL RLS, or a closed Next.js security gate.

## Problem and engineering response

| Engineering problem                                  | QueueForge response                                                                                             | Evidence location                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| A database commit and queue publish cannot be atomic | PostgreSQL transactional outbox, leases, deterministic job IDs, durable consumer receipts                       | [Event flow](event-flow.md), worker/persistence tests       |
| Multi-tenant IDs can be mixed accidentally           | Mandatory tenant-scoped stores plus composite tenant foreign keys                                               | [Database](database.md), database schema integration test   |
| Retries can duplicate effects                        | Durable idempotency for selected commands, state/unique replay guards, and `(tenant, consumer, event)` receipts | [Architecture](architecture.md), concurrency/recovery tests |
| Workflow edits can change in-flight meaning          | Immutable activated versions, ordered target content hash, request-to-version binding                           | [Database](database.md), workflow tests                     |
| Approval races and self-approval can bypass policy   | Locked task/request transaction, revision check, payload binding, role and self-policy recheck                  | [Event flow](event-flow.md), concurrency tests              |
| Webhooks create forgery, replay, and SSRF risk       | Raw-body HMAC, nonce/receipt persistence, encrypted key versions, allowlist, DNS/address pinning, no redirects  | [Security](security.md), webhook security tests             |
| Async failures are difficult to explain              | Correlation IDs, append-only-for-runtime history, attempts, DLQs, heartbeats, readiness, metrics                | [API design](api-design.md), dashboard and operations views |

## Architecture decisions worth discussing

### PostgreSQL as durable truth, Redis as coordination

BullMQ is allowed to redeliver. Consumer receipts and domain effects commit in PostgreSQL, so correctness does not depend on retained Redis jobs. This avoids an unsupported exactly-once claim and gives the operator a recovery source after Redis interruption.

### REST commands, GraphQL composition

REST retains explicit idempotency headers, status codes, webhook raw-body semantics, and operational resources. GraphQL composes dashboard/request reads and reuses the same application command services for submit/approval mutations. There is one authorization and transaction layer, not two implementations.

### Application tenancy plus database constraints

Every tenant-owned store requires context and every important relationship repeats `tenant_id`. This blocks cross-tenant references even when application code is wrong. The tradeoff is explicit: no RLS claim, so repository APIs and integration probes remain critical controls.

### Static-export web app

The Next App Router dashboard exports static files and calls Nest directly. It avoids server-side secrets, Server Actions, and route handlers in the web tier. The tradeoff is client bootstrap/polling and a direct API CORS/CSRF boundary.

### Local resource budget

Host-first development runs only PostgreSQL/Redis in Docker. The full Compose profile caps CPU, memory, PIDs, privileges, and exposed ports. Performance and capacity claims still require measured artifacts; configured caps are not measured peaks.

## Resume bullet candidates

Use only bullets supported by a passing run from the revision you are presenting. Replace bracketed evidence with real numbers only after measurement.

- Designed and implemented a TypeScript workflow-automation monorepo with NestJS REST/GraphQL, PostgreSQL/TypeORM, Redis/BullMQ, and a static-export Next.js operator dashboard.
- Built a transactional outbox with `FOR UPDATE SKIP LOCKED` leases, deterministic BullMQ IDs, and durable consumer receipts to recover at-least-once processing without duplicating QueueForge-owned database effects in tested scenarios.
- Enforced multi-tenant integrity with tenant-scoped application adapters, composite PostgreSQL foreign keys, tenant-leading indexes, and cross-tenant integration probes.
- Implemented immutable workflow versions, optimistic draft autosave, approval revision/self-approval controls, durably idempotent submission/selected commands, intrinsic decision replay, and append-only-for-runtime operational history.
- Added one-time-reveal API clients with domain-separated hashed secrets, tenant-bound authentication, restricted viewer/operator scope, audited creation/revocation, last-used tracking, and immediate revoke checks.
- Hardened signed webhook boundaries with raw-body HMAC verification, durable nonce/idempotency receipts, AES-GCM key storage, exact host allowlisting, DNS/address pinning, redirect rejection, and bounded retry/DLQ handling.
- Delivered an accessible responsive control desk with permission-aware actions, explicit offline/empty/error/forbidden states, sortable/filterable data tables, theme/reduced-motion support, Storybook states, Testing Library, and axe checks.
- Created local engineering gates for real PostgreSQL/Redis concurrency and recovery tests, Playwright journeys, k6 smoke checks, dependency/secret scanning, and commit-pinned CI configuration; remote-green status is claimed only when a real run is linked.

Do not write “exactly once,” “production ready,” “zero vulnerabilities,” “RLS-secured,” or benchmark figures unless the implementation and current evidence actually justify them.

## Interview walkthrough

### 1. Start with the invariant

“If the API tells the user a request committed, PostgreSQL must contain enough durable state to finish or explain it even if Redis or a worker fails immediately afterward.”

Then trace command transaction -> outbox lease -> deterministic job -> consumer receipt -> follow-on webhook/notification event.

### 2. Draw the failure window

Explain the crash after `queue.add` but before `outbox_events.status='published'`. The row is reclaimed and may publish again. BullMQ ID helps, but the durable receipt is the authoritative duplicate guard.

### 3. Show tenant defense in depth

Explain validated session membership, mandatory tenant context, tenant-scoped lookups, and composite foreign keys. State explicitly why this is not RLS.

### 4. Show one concurrency decision

Use approval or idempotent submission: a unique key plus row locking/transaction serialization converges concurrent identical calls on one committed effect and a replay response. A different fingerprint conflicts.

### 5. End with operational proof

Use one correlation ID to connect the request, transitions, attempts, outbox, delivery, notification, and audit views. Point to tests that induce replay/retry rather than describing only the happy path.

## Likely interview questions

### Why not publish directly to Redis inside the API request?

A database commit could succeed while publish fails, or publish could succeed while the transaction rolls back. The outbox makes the intended message part of the authoritative transaction and lets a separate dispatcher retry it.

### Why are deterministic BullMQ IDs not sufficient idempotency?

Job retention is bounded and Redis is coordination state. A job can be redelivered or recreated after retention. The database receipt ties the logical event to the committed consumer effect.

### What does “at least once” mean here?

The system may execute delivery attempts more than once. QueueForge deduplicates its own database effects by durable event identity. An external receiver must use the stable event ID; arbitrary HTTP exactly-once delivery is impossible to guarantee from the sender alone.

### How do you prevent cross-tenant data access?

Tenant authority comes from a verified session or credential, not a body field. Stores require tenant context and filter every lookup. Composite foreign keys repeat the tenant on child/parent bindings. Tests deliberately attempt a cross-tenant insert and cross-tenant access paths.

### How are active workflow changes handled?

Active content is immutable. An editor clones to a draft, autosaves with an expected revision, and activates a newly hashed version. Existing requests continue to reference their original version.

### What happens when Redis is down?

The API readiness check degrades, but any already committed request and outbox row remain in PostgreSQL. The dispatcher retries after Redis returns; it never marks a publish successful before the queue call and lease-owner acknowledgement.

### How are webhooks secured?

Inbound: exact raw bytes with timestamp, nonce, event, idempotency, and key identity bound into the HMAC, plus durable replay keys and receipts. Outbound: encrypted versioned secrets, immutable payload snapshot, HMAC bound to event/timestamp/attempt, exact allowlist, resolved-address pinning, no redirects, timeouts, and attempt history.

### What would you add before production?

Close the Next.js security gate; define a supported TLS/reverse-proxy deployment; revisit RLS and secret management/KMS; add managed backup/restore and disaster-recovery drills; external observability/alerting; retention/erasure policy; production identity/SSO and API-client lifecycle; capacity evidence; and a real CI/CD/deployment approval chain.

## STAR-style project story

**Situation:** A portfolio system needed to demonstrate more than CRUD: tenant isolation, approvals, queues, retries, security boundaries, and explainable failure recovery on a 16 GB Windows laptop.

**Task:** Build one coherent local system where the async story remained correct under duplicate delivery, worker interruption, concurrency, and webhook failure, while keeping claims honest.

**Action:** Center the architecture on PostgreSQL transactions and an outbox; isolate domain/application/persistence packages; implement tenant composite constraints, immutable versions, locked approvals/idempotency, durable receipts, signed allowlisted webhooks, and a dense accessible operator UI. Add real database/Redis tests and explicit claim/security gates.

**Result:** The repository contains a reproducible local demonstration and targeted proof surfaces for concurrency, isolation, recovery, signing, and accessibility. Insert only verified run outcomes or measurements here; do not infer them from the design.

## Evidence checklist before sharing

- [ ] The repository revision is identified and secrets are absent.
- [ ] README quickstart works from a clean local environment.
- [ ] `pnpm verify:local` has a preserved successful run for that revision.
- [ ] E2E, accessibility, and k6 artifacts exist before mentioning their results.
- [ ] A real remote CI URL exists before saying CI is green.
- [ ] Screenshot routes were captured from the same revision and contain no secrets.
- [ ] The Next.js gate status is stated accurately.
- [ ] Performance figures name hardware, scenario, duration, data shape, and thresholds.
- [ ] Claims say at-least-once and application-enforced tenancy; they do not imply exactly-once or RLS.

## Portfolio links to lead with

1. [README and quickstart](../README.md)
2. [Architecture](architecture.md)
3. [Event flow](event-flow.md)
4. [Database constraints and locking](database.md)
5. [Security controls](security.md) and [threat model](threat-model.md)
6. [Testing](testing.md) and [load testing](load-testing.md)
7. [Live demo script](demo-script.md)

The strongest presentation uses a specific invariant, a controlled failure, and the artifact that proves recovery instead of a long feature list.
