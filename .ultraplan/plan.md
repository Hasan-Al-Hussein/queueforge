# Implementation Plan: QueueForge

## Context and evidence
Build a local-only, recruiter-runnable workflow platform whose approval → durable outbox → BullMQ → signed webhook path is proven under concurrency and failure, then derive all portfolio claims from recorded evidence.

- **Source of truth**: the 772-line pasted brief; project mode is mixed business/coding because runnable software feeds screenshots, documentation, and career material.
- **Repository**: empty Git worktree with no commits or remotes; all paths below are new. Work will move to `codex/queueforge-build` and use phase checkpoints.
- **Host**: Windows 11, i7-1255U, 15.68 GiB RAM (about 2.4–2.5 GiB currently free), 52.25 GiB disk free; Node 24.13, pnpm 11.19, Docker 29.7/Compose 5.3, Git 2.49, PowerShell 7.6.
- **Existing state**: unrelated containers remain untouched; port 3000 is occupied. QueueForge defaults: web 3100, API 3001, sink 3300, PostgreSQL 5432, Redis 6379.
- **Current versions verified from primary sources/registry**: Nest 11.2.1, TypeORM 1.1.0, `@nestjs/typeorm` 11.0.3, BullMQ 6.2.0, Next 16.3.2, React 19.2.8; foundation work will exact-pin direct dependencies and freeze `pnpm-lock.yaml`.

## Architecture and ADR decisions

1. **Workspace/processes**: plain pnpm workspaces, no Nx/Turbo daemon. `apps/api` (Nest REST/GraphQL/inbound HTTP), `apps/worker` (Nest application context/outbox/BullMQ), `apps/web` (Next App Router static export), and `apps/webhook-sink` (small local Node receiver). Host-first development runs only PostgreSQL/Redis in Docker; the full Compose demo uses capped containers.
2. **Package DAG**: `packages/contracts` → `packages/{config,domain}` → `packages/persistence` → `packages/application`; `packages/observability` is shared by backend processes; `packages/ui` is web-only; `packages/testkit` is test-only. Generic TypeORM repositories never escape persistence adapters.
3. **ORM**: TypeORM beats Prisma here because native PostgreSQL lock modes/`SKIP LOCKED`, explicit SQL migrations, composite FKs, partial indexes, and Nest integration outweigh Prisma's stronger generated types and would avoid raw-SQL escape hatches for every outbox claim. `synchronize:false` everywhere; a real migration/locking probe is a gate. Record this in `docs/adr/0001-typeorm.md`.
4. **REST versus GraphQL**: REST is the external command/operations API because headers, idempotency, status codes, pagination, OpenAPI, approvals, retry/replay, and webhooks are explicit. GraphQL supplies composite dashboard/request-timeline reads plus the required `submitWorkflowRequest` mutation through the same application service; no subscriptions or duplicate admin CRUD. Record in `docs/adr/0002-api-split.md`.
5. **Delivery semantics**: PostgreSQL is authoritative; Redis/BullMQ is at-least-once coordination. Never claim exactly-once delivery to arbitrary webhook receivers. The local sink deduplicates stable event IDs only to prove receiver-side idempotency.
6. **Optional tools**: use isolated Compose services instead of Testcontainers and in-app/console notifications instead of Mailpit to reduce Windows flakiness and memory. Use built-in JSON logs/Prometheus-format metrics rather than a heavy monitoring stack.

## Security context and preliminary threat model

- Intended use is loopback/local demonstration with synthetic data, not public or production deployment. Trust boundaries are browser→API, API clients/inbound webhooks→API, API/worker→PostgreSQL, API/worker→Redis, worker→allowlisted sink, and developer/CI→dependencies/secrets.
- Protected assets are tenant isolation, passwords/access/refresh tokens, API and webhook keys, immutable workflow/request/approval state, outbox/inbox correctness, audit integrity, and availability within laptop limits.
- Highest threats are cross-tenant object/relationship access (`TM-001`), refresh-token theft/reuse (`TM-002`), forged/replayed webhooks (`TM-003`), outbound SSRF/redirect/DNS tricks (`TM-004`), duplicate/lost effects across crash windows (`TM-005`), GraphQL/input/rate abuse (`TM-006`), secret/log/supply-chain exposure (`TM-007`), and browser XSS/CSRF/caching leaks (`TM-008`).
- Controls: UUIDs, mandatory tenant context and composite tenant FKs, deny-by-default RBAC, Argon2id passwords, hashed opaque refresh-token families with reuse revocation, in-memory access tokens plus HttpOnly refresh cookie and double-submit CSRF, raw-body constant-time HMAC, durable nonce window, strict validation/size/rate limits, encrypted webhook secrets, redirect-disabled post-resolution host allowlist, parameterized SQL, CSP/headers/no shared sensitive cache, redacted structured logs, DB append-only triggers/runtime grants, exact lockfile, scans, and targeted negative tests.
- The final repo-grounded `docs/threat-model.md` must cite implemented paths and downgrade assumptions that remain local-only; no claim of RLS, cryptographic audit immutability, cloud hardening, or internet exposure.

## Persistence and domain contract

- Opaque UUIDs and `TIMESTAMPTZ`; every tenant table uses `tenant_id NOT NULL`, composite primary/unique keys, tenant-leading indexes, and composite FKs `(tenant_id, foreign_id)` so cross-tenant relationships fail in PostgreSQL. Reads still require tenant-scoped adapters; no RLS claim.
- Tables: tenants, users, memberships, API clients, refresh families/tokens; workflow templates/versions/targets; requests/transitions/attempts; approvals/decisions; idempotency; outbox/attempts/processed events; endpoints/secrets/inbound receipts/replay keys/outbound deliveries/attempts; notifications/deliveries; dead letters; worker heartbeats; audit/security events.
- Activated workflow content is immutable by trigger. Draft autosave is `UPDATE ... WHERE status='draft' AND revision=:expected`; activation locks the template, retires the prior active without changing content, hashes/activates the draft, and commits. Editing active content clones a new draft version.
- The centralized request state machine permits only `received→validation_failed|pending_approval|queued`, `pending_approval→approved|rejected|cancelled`, `approved→queued`, `queued→processing|cancelled`, `processing→succeeded|failed`, `failed→queued|dead_lettered`, and authorized `dead_lettered→queued`; transitions, audit, and outbox records share the mutation transaction.
- Approval binds task/request/version/payload hash; transaction locks task+request, rechecks tenant/role/self-approval, inserts one unique decision, CAS-transitions the request, appends audit/outbox, and commits. Identical replay returns the result; stale/opposite/unauthorized attempts fail.
- Idempotency uniqueness is `(tenant_id, endpoint_scope, key_hash)`. Canonical JSON + principal + operation forms the fingerprint. Insert-on-conflict and `SELECT FOR UPDATE` serialize races; different payload/principal returns 409; domain state, stored response, audit, and outbox commit together, so pre-commit crashes roll back and post-commit retries replay.
- Refresh rotation locks the family, verifies a hashed high-entropy token, marks it consumed, inserts exactly one unique child, and rechecks membership. Reuse of a consumed/revoked token marks and revokes the entire family; logout revokes it. Access JWTs are short-lived and session-bound.
- Append-only triggers plus runtime-role `REVOKE UPDATE, DELETE, TRUNCATE` protect audit events, transitions, decisions, outbox attempts, and webhook attempts; metadata is bounded/redacted. Migrations run under a distinct owner.

## Outbox and webhook crash-window invariant

1. Domain update, state transition, safe audit event, idempotency result, and outbox insert commit in one PostgreSQL transaction.
2. Dispatcher atomically claims due or expired-lease rows with `FOR UPDATE SKIP LOCKED`, records owner/expiry/attempt, commits, enqueues `jobId=qf-<event UUID>`, then conditionally marks published for the same lease owner.
3. A crash after enqueue/before publish marking causes replay; deterministic BullMQ IDs and database `processed_events PRIMARY KEY (tenant_id,consumer,event_id)` prevent repeated database effects.
4. Worker receipt, database effects, attempt/transition/audit records, and follow-on outbox events commit together; the receipt outlives BullMQ retained jobs.
5. Publish failure sets bounded exponential-backoff/jitter retry or dead state; expired leases are reclaimable. Request and outbound-delivery DLQs remain separate and manually replayable with authorization/history.
6. Inbound signature is HMAC-SHA256 over `timestamp.nonce.rawBody` with versioned key ID, 5-minute skew, required external idempotency key, constant-time equal-length comparison, pre-parse verification, and durable tenant/endpoint nonce uniqueness.
7. Outbound signature is HMAC-SHA256 over `eventId.timestamp.attempt.rawBody`; delivery snapshots URL/payload/key version, disables redirects, times out, restricts `http/https`, resolves and rechecks the exact local allowlist, records every attempt, and rotates active/retiring encrypted secrets.

## Transport, auth, and authorization contract

- `platform_admin` is global and may enter a tenant only through an audited tenant-selection action. Tenant roles: viewer (read), approver (viewer + decide), operator (viewer + submit/cancel/retry/replay), tenant_admin (all tenant configuration/membership/API-client/workflow actions plus operational permissions). Self-approval policy applies to every role. API clients are scoped operator/viewer only.
- Tenant identity comes from the validated JWT/session membership or hashed API key; `X-Tenant-Id` is accepted only after membership/platform authorization and never from a body. Every controller, resolver, worker, replay, and lookup passes a non-optional `TenantContext`.
- Auth routes: register/bootstrap, login, refresh, logout, logout-all, session/me, tenant select. Browser access JWT stays in memory; opaque refresh cookie is HttpOnly, SameSite=Lax, path-scoped, `Secure` only when TLS is actually enabled. Refresh/logout require strict Origin allowlist plus double-submit `X-CSRF-Token`; CORS only permits the configured web origin with credentials.
- REST `/api/v1`: workflows/drafts/activate, requests/submit/list/detail/cancel/retry, approvals/list/decide, webhook endpoints/secrets/deliveries/replay, notifications, audit, users/memberships/API-clients, operations/queues/dead-letters, and live/ready/metrics. Mutating/replay routes require `Idempotency-Key` where repeat effects matter.
- GraphQL: `viewer`, `dashboardOverview`, `requestDetail`, `requestTimeline`, `workflowCatalog`, and `submitWorkflowRequest`; application services and RBAC are shared with REST. Limit request body 128 KiB, depth 8, complexity 200, aliases 20, page size 100, and disable introspection outside local development.
- REST JSON default is 256 KiB; webhook endpoint cap is configurable up to 1 MiB. Auth is limited by email+IP, submission by principal, webhook by endpoint, replay by actor; all lists use validated filters/sort allowlists and stable page/pageSize ordering.
- Errors use `{ error:{ code,message,details? }, requestId, correlationId, timestamp }`; no stacks/secrets. Correlation IDs propagate through HTTP/GraphQL, transaction, outbox, queue, worker, webhook, notification, and audit.

## Agent ownership and execution waves

- **Master/root only**: root manifests, `pnpm-lock.yaml`, workspace/TS/lint/format config, `.env.example`, Compose/Dockerfiles, `packages/contracts`, `packages/config`, CI, shared API/event freezes, integration, security review, screenshots, commits, and final claims. Agents request changes to these files.
- **Persistence/API lane** after foundation: `packages/domain`, `packages/persistence`, `packages/application`, `packages/observability`, `apps/api`; owns migrations and backend unit/integration tests but not root contracts.
- **Worker lane** only after schema/event freeze: `apps/worker`, `apps/webhook-sink`, worker-specific tests; cannot alter entity/contract/root files without master review.
- **Frontend lane** only after transport freeze: `apps/web`, `packages/ui`, stories/component tests; cannot weaken server auth or change contracts.
- **QA/docs lane** after the vertical path stabilizes: `tests/e2e`, `load-tests`, `docs`, evidence/claim ledger; it reports runtime defects to owning lanes rather than silently changing their contracts.
- Root reviews every lane diff, runs its focused checks, resolves overlaps, then commits a dependency-safe checkpoint before the next wave.

## Implementation sequence

1. Materialize `docs/environment.md`, repo/evidence maps, ADRs, schema/architecture/event diagrams, threat-model draft, verification plan, and security exception from this reviewed plan.
2. Create branch and workspace; exact manifests, strict TS, lint/format, env validation/secret generator, static Next export, capped Compose/test topology, Dockerfiles, CI/scans, and smoke builds. Freeze contracts and schemas.
3. Implement migrations/seeds and pure domain invariants; prove migration up/down, composite tenant-FK rejection, state machine, hashes, backoff, and audit sanitization before transports.
4. Implement authentication/session rotation, tenant/RBAC adapters, workflow versioning/autosave, request/idempotency/approval transactions, REST/OpenAPI/GraphQL limits, health/metrics, and negative isolation/race tests.
5. Implement outbox claim/lease, BullMQ worker/retries/progress/timeouts/stalls/DLQs, notification providers, signed webhook flows/sink, replay, heartbeat, shutdown, Redis outage and crash recovery tests.
6. Implement the responsive static-export dashboard, operational tables/charts, approval/timeline/DLQ/webhook/audit/team views, workflow autosave/conflict recovery, Storybook, component/a11y tests, and permission-aware UX.
7. Run all 12 Playwright journeys, k6 laptop workloads, resource/disk measurement, scans, browser/security/quality audits, and clean-archive setup; preserve failure evidence and fix root causes.
8. Capture real screenshots, reconcile every README/career claim to evidence, finish all named docs/demo/troubleshooting material, and run final local and vendor-release gates.

## Verification and recovery matrix

| ID | Criterion | Command/proof | Expected evidence | Owner/reviewer | Failure and recovery trigger |
|---|---|---|---|---|---|
| ENV-01 | Prerequisites/limits | `pwsh scripts/verify-environment.ps1` | `artifacts/verification/environment.json`; correct versions/ports/headroom | master | Unsafe RAM/port → host-first/sequential mode; never stop unrelated services |
| BUILD-01 | Reproducible static quality | `pnpm verify` | format/lint/typecheck/unit/build all zero; exact lock | master | Any error/range/TODO → fix before phase commit |
| DB-01 | Migrations/schema/indexes | `pnpm test:db` | up/down/up, seed, composite-FK/trigger and EXPLAIN assertions | persistence/master | Failed migration/index → `pnpm db:migrate:revert` or reset only synthetic test DB |
| DOM-01 | Legal transitions | `pnpm --filter @queueforge/domain test` | exhaustive edge table passes | persistence | Illegal transition → block API/worker integration |
| TEN-01 | No cross-tenant access/inference | `pnpm test:integration -- tenant-isolation` | read/write/FK/GraphQL/job/replay matrix denies tenant B | persistence/master | Any leak is release blocker; repair adapter/FK and rerun full suite |
| AUTH-01 | Auth/rotation/logout | `pnpm test:integration -- auth` | Argon2id, concurrent rotate, reuse family revocation, CSRF/cookie checks pass | persistence/master | Reused/revoked token works → release blocker |
| WF-01 | Immutable versions/autosave | `pnpm test:integration -- workflows` | active mutation rejected; clone/activation/revision conflict passes | persistence | In-place active edit/stale overwrite → trigger/CAS fix |
| IDEM-01 | Concurrent idempotency | `pnpm test:integration -- idempotency` | one request/outbox/effect; same response replay; mismatch 409 | persistence/master | Duplicate or wrong replay → transaction/constraint fix |
| APR-01 | Approval races/auth | `pnpm test:integration -- approvals` | one decision; stale/self/unauthorized/opposite attempts denied | persistence/master | Multiple decisions/execution → release blocker |
| OUT-01 | Transactional outbox | `pnpm test:integration -- outbox` | rollback, dual-dispatcher `SKIP LOCKED`, post-enqueue crash replay safe | worker/master | Lost/duplicate DB effect → lease/receipt transaction fix |
| QUE-01 | Worker recovery/DLQ | `pnpm test:integration -- worker` | retry+jitter, timeout/progress, kill/stall recovery, exhausted DLQ/manual retry | worker/master | Lost/stuck job or duplicate effect → block E2E |
| WH-01 | Inbound/outbound security | `pnpm test:integration -- webhooks` | bad/old/replayed HMAC denied; redirect/host blocked; retry/history/replay verified | worker/master | Forgery, replay, SSRF, missing history → release blocker |
| AUD-01 | Complete safe trace | `pnpm test:security -- audit` | correlated journey events; append-only DB failure; secret canary absent | persistence/master | Missing event/canary leak → sanitize/emitter fix |
| API-01 | REST/OpenAPI/GraphQL | `pnpm test:contract` | versioned schema/error snapshots, RBAC, depth/complexity/N+1 bounds | persistence/master | Drift/auth bypass/unbounded query → block frontend freeze |
| UI-01 | Components/forms/autosave | `pnpm test:web` | Vitest/Testing Library and required stories pass | frontend/master | Stale overwrite, false permission, missing states → fix before E2E |
| A11Y-01 | Keyboard/focus/labels/contrast | `pnpm test:a11y` plus scripted walkthrough | axe results and checklist in `artifacts/verification/a11y` | frontend/master | Critical issue → fix before screenshots |
| E2E-01 | Complete 12-step journey | `pnpm test:e2e` | Playwright report/traces/screenshots including isolation/crash/DLQ | QA/master | Any failure/flakiness → preserve trace and diagnose owning layer |
| PERF-01 | Honest laptop workload | `pnpm test:load:smoke` | raw k6 output: zero correctness errors/no duplicates, documented p95 for fixed local load | QA/master | Threshold/resource failure → profile/tune or lower and document workload honestly |
| RES-01 | <5 GiB RAM/<4 GiB added disk | `pwsh scripts/measure-resources.ps1` | process/container peaks and project/image/volume/cache deltas | master | Budget exceeded → static web/slim images/retention/caps; abort unsafe full run |
| SEC-01 | Practical security posture | `pnpm audit:local` | dependency/secret/header/CORS/security tests and reconciled threat model | master | Exploitable high/committed secret → block, fix, rotate generated local values |
| RUN-01 | One-command/clean archive | `pwsh scripts/verify-clean-start.ps1` | frozen install, generated env, full demo health and representative flow from tracked archive | master | Undocumented manual step → script/README fix |
| DOC-01 | Docs/claims match reality | `pwsh scripts/verify-claims.ps1` | every README/CV/LinkedIn claim maps to test, measurement, screenshot, or file | QA/master | Unsupported claim removed/qualified; never claim production/cloud/exactly-once/remote CI |
| NEXT-01 | Upstream critical patch | `pnpm security:next-gate && pnpm verify:release` | patched Aug-26-or-later Next version, new lock, audit + web/E2E/full regression pass | master | Until available/pass: local loopback exception only; status is not secure/complete/exposure-ready |

## Rollback, recovery, and stop conditions

- Conventional phase commits on `codex/queueforge-build`; use `git revert`/follow-up commits, never destructive reset. Root integrates only reviewed lane changes.
- Destructive integration tests use explicit `queueforge-test` Compose project and named test volumes; cleanup validates resolved names before `docker compose -p queueforge-test down -v`. Development data remains synthetic and resettable.
- Every migration has a reviewed `down` path where PostgreSQL permits it; failed upgrade runs `pnpm db:migrate:revert`. The documented demo recovery may recreate only QueueForge volumes after exact-name validation.
- Stop promotion on cross-tenant disclosure, duplicate domain effects, invalid approval/token replay, lost committed outbox work, forged/replayed webhook acceptance, secret leakage, unpatched known critical dependency for exposure, or measured resource-budget breach.
- The temporary Next 16.3.2 exception permits loopback-only implementation/testing with static-export production artifacts and no Server Actions/Next route handlers. On/after 2026-08-26 install the vendor patch, regenerate the lock, audit, and rerun frontend/E2E/full regression before declaring final completion; if unavailable, deliver all evidence with this single external gate explicitly open.

## Final commands

Local engineering gate: `pnpm verify:local`

Final release/evidence gate: `pnpm security:next-gate && pnpm verify:release`
