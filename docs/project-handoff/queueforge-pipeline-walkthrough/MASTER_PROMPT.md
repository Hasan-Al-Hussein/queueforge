# QueueForge: master handoff prompt for the next chat

You are taking over the completed QueueForge local project. Your assignment is to inspect and understand the existing project, its numbered pipeline screenshots, documentation, current Git repository, and revision-matched private ZIP. After you are fully oriented, create a GitHub repository for this complete project using the same normal GitHub-repository workflow you have used for this user’s other repositories.

Do not redesign, rewrite, regenerate, or reorganize QueueForge for this handoff. Do not treat this prompt as an implementation recipe for the code or design. The existing source is authoritative. Repository-creation mechanics are yours to handle in your usual way; this prompt intentionally provides facts, scope, paths, constraints, and evidence rather than prescribing those mechanics.

## 1. Start here

Define `<REPO_ROOT>` as the Git top-level directory containing the root `package.json`, `pnpm-lock.yaml`, `apps`, and `packages`. The chat should already be opened in that repository. Every path below is relative to this root, which keeps the handoff portable and avoids publishing a personal workstation path.

Current local repository root placeholder:

```text
<REPO_ROOT>
```

Important path facts:

- The directory named `Projects` is itself the QueueForge Git repository. Do not look for a nested QueueForge source repository.
- The path contains spaces. Treat it literally.
- Source-of-truth branch at handoff preparation: `codex/queueforge-build`.
- Resolve the actual handoff revision from the current Git `HEAD`; do not assume an older hash from prior evidence or ZIPs.
- At handoff preparation there was no Git remote and no tag. Verify the current state before acting.
- Never upload the ignored local `.env`, dependencies, build output, browser state, logs, or local database volumes.

Visual starting point:

```text
<REPO_ROOT>\docs\project-handoff\queueforge-pipeline-walkthrough\README.md
```

Numbered screenshot folder:

```text
<REPO_ROOT>\docs\project-handoff\queueforge-pipeline-walkthrough
```

This master prompt:

```text
<REPO_ROOT>\docs\project-handoff\queueforge-pipeline-walkthrough\MASTER_PROMPT.md
```

Private ZIP directory:

```text
<REPO_ROOT>\dist
```

The current ZIP follows this rule:

```text
QueueForge-private-<current Git HEAD short 8 characters>.zip
```

Resolve the current short revision from the repository and select the ZIP with that exact suffix. Do not use an older ZIP merely because it has a recent filesystem timestamp. The working source tree is the authority; the ZIP is a revision-bound distribution copy for inspection and private transfer.

## 2. What QueueForge is

QueueForge is a local-first, multi-tenant workflow-automation system and engineering demonstration. It solves a common reliability problem: a business request may need strict validation, approval by another person, durable background processing, bounded retry, delivery to another system, notifications, and an explainable history. A basic form-plus-background-job design can lose committed work, repeat effects, mix tenant data, allow the wrong role to act, or make failures impossible to diagnose.

QueueForge provides:

- Guided request forms so ordinary users do not enter JSON.
- Separate Administrator, Operator, Approver, and Viewer workspaces.
- Immutable published request-type versions.
- Strict schema validation and canonical payload hashing.
- Durable idempotency for supported command surfaces.
- Optional approval, decision revision checks, and self-approval prevention.
- PostgreSQL transactional outbox dispatch.
- Redis/BullMQ at-least-once queue processing.
- Durable QueueForge-owned effect receipts and deterministic event/job identifiers.
- Bounded automatic retry and separate dead-letter recovery.
- Signed outbound webhooks and separately verified inbound webhooks.
- Per-user notifications, request timelines, delivery history, processing health, and append-only operational audit history.
- Tenant-scoped REST and GraphQL surfaces.
- Full local Docker Compose packaging, tests, evidence scripts, and private ZIP packaging.

Root package metadata is `queueforge` version `0.1.0`, licensed MIT. The root manifest is marked `private` to prevent accidental npm publication; that flag does not decide GitHub repository visibility.

This is a synthetic local portfolio/engineering product. It is not currently an internet-facing production deployment reference.

## 3. The user-visible example in the screenshot folder

The numbered walkthrough uses one real correlated local-demo request:

- Tenant/workspace: `Acme Operations`
- Request type: `Expense review`, active immutable version `v2`
- Requester: `Omar Operator`
- Approver: `Amina Approver`
- Amount: `1,250`
- Cost Center: `OPS-42`
- Summary: `Pipeline walkthrough expense`
- Approval note: `Approved for the pipeline walkthrough`
- QueueForge request ID: `ec2a5104-92df-44a3-86d4-3a523e001dd2`
- Correlation/trace ID: `03355893-e8bb-457b-993e-9723ee9731da`
- Outcome: succeeded on the first processing attempt, one notification created, and one signed result delivery accepted by the local receiver with HTTP `202`.

All identities and values in the screenshots are synthetic. The preserved local database also contains older synthetic load-test activity, so use the request and trace references above to follow the exact walkthrough.

## 4. Read these project documents in this order

1. Visual walkthrough:
   `<REPO_ROOT>\docs\project-handoff\queueforge-pipeline-walkthrough\README.md`
2. Root overview and run commands:
   `<REPO_ROOT>\README.md`
3. End-to-end flow:
   `<REPO_ROOT>\docs\event-flow.md`
4. Architecture:
   `<REPO_ROOT>\docs\architecture.md`
5. Demo guide:
   `<REPO_ROOT>\docs\demo-script.md`
6. API design:
   `<REPO_ROOT>\docs\api-design.md`
7. Database design:
   `<REPO_ROOT>\docs\database.md`
8. Event contracts:
   `<REPO_ROOT>\docs\event-contracts.md`
9. Security model:
   `<REPO_ROOT>\docs\security.md`
10. Threat model:
    `<REPO_ROOT>\docs\threat-model.md`
11. Testing guide:
    `<REPO_ROOT>\docs\testing.md`
12. Troubleshooting:
    `<REPO_ROOT>\docs\troubleshooting.md`
13. Environment baseline:
    `<REPO_ROOT>\docs\environment.md`
14. Load-test contract:
    `<REPO_ROOT>\docs\load-testing.md`
15. Portfolio/interview explanation:
    `<REPO_ROOT>\docs\career-pack.md`
16. Design system:
    `<REPO_ROOT>\design-system\queueforge\MASTER.md`
17. Grounded implementation plan:
    `<REPO_ROOT>\.ultraplan\plan.md`
18. ADRs:
    `<REPO_ROOT>\docs\adr\0001-typeorm.md`
    and
    `<REPO_ROOT>\docs\adr\0002-api-split.md`

## 5. High-level runtime architecture

```text
Browser / static Next.js interface
        |
        v
Nest API: REST + GraphQL + auth + health + inbound webhook boundary
        |
        v
PostgreSQL: authoritative tenant, workflow, request, approval, outbox, delivery and audit state
        |
        v
Transactional outbox dispatcher
        |
        v
Redis / BullMQ queues
        |
        v
Request, webhook and notification workers
        |
        v
Signed local receiver + durable delivery/notification/audit visibility
```

Runtime components:

- `apps/api`: NestJS HTTP/GraphQL process.
- `apps/worker`: Nest application context running the outbox dispatcher and BullMQ consumers.
- `apps/web`: Next.js App Router interface exported as static files and served by Nginx in the full profile.
- `apps/webhook-sink`: local signed receiver and controlled host-first failure injector.
- PostgreSQL 17: durable source of truth.
- Redis 8: queue coordination; not the authoritative business-state store.

## 6. Full product pipeline and exact source areas

### A. Authentication and selected-tenant context

The browser signs in, holds the access token in memory, uses a rotating refresh-token family, and selects one authorized tenant membership. Tenant context comes from the authenticated session and verified membership rather than arbitrary body data. Auth state changes and security events preserve correlation.

Inspect:

- `apps/web/src/features/auth/login-screen.tsx`
- `apps/web/src/providers/auth-provider.tsx`
- `apps/web/src/api/client.ts`
- `apps/api/src/controllers/auth.controller.ts`
- `packages/application/src/auth.service.ts`
- `packages/persistence/src/stores/identity.store.ts`
- `packages/persistence/src/entities/identity.entities.ts`

### B. Administrator defines and publishes a request type

The Administrator configures the user-facing questions, approval policy, self-approval rule, processing settings, retry budget, webhook targets, and notification targets. Drafts autosave with revision checks. Once active, a version is immutable; changing future behavior requires a new draft/version.

Inspect:

- `apps/web/src/features/workflows/workflows-screen.tsx`
- `apps/web/src/features/workflows/workflow-editor-screen.tsx`
- `apps/web/src/components/workflow-field-builder.tsx`
- `apps/web/src/components/workflow-schema.ts`
- `apps/api/src/controllers/workflow.controller.ts`
- `packages/application/src/workflow.service.ts`
- `packages/persistence/src/stores/workflow.store.ts`
- `packages/persistence/src/entities/workflow.entities.ts`

### C. Operator submits a guided request

The Operator selects an active request type and fills generated normal fields. The UI converts those answers into the schema-bound payload; the user does not need to author JSON.

Inspect:

- `apps/web/src/features/requests/requests-screen.tsx`
- `apps/web/src/components/guided-request-form.tsx`
- `apps/web/src/components/human-readable-payload.tsx`
- `apps/api/src/controllers/request.controller.ts`
- `apps/api/src/graphql/queueforge.resolver.ts`

### D. API validation, immutable binding, idempotency and atomic intake

The application resolves the active request type, validates without coercion, canonicalizes and hashes the payload, binds the request to the exact immutable workflow version, applies idempotency, records the initial state transitions and audit evidence, and appends the required outbox event in the same PostgreSQL transaction.

Inspect:

- `packages/application/src/request.service.ts`
- `packages/domain/src/schema-validator.ts`
- `packages/domain/src/canonical-json.ts`
- `packages/domain/src/state-machine.ts`
- `packages/persistence/src/stores/request-submission.store.ts`
- `packages/persistence/src/stores/idempotency-record.ts`
- `packages/persistence/src/entities/request.entities.ts`

### E. Separate approval decision

If approval is required, a different Approver sees a readable request. The decision transaction locks the task/request, checks the expected revision, role, payload binding, prior decision, and self-approval rule, inserts one decision, transitions the request, records audit/notification state, and appends the next outbox event.

Inspect:

- `apps/web/src/features/approvals/approvals-screen.tsx`
- `apps/api/src/controllers/approval.controller.ts`
- `packages/application/src/approval.service.ts`
- `packages/persistence/src/stores/approval.store.ts`

### F. Transactional outbox dispatch

The dispatcher leases due outbox rows using PostgreSQL locking, commits the lease, maps supported events to one of three queues, publishes deterministic job IDs of the form `qf-<eventId>`, and conditionally records successful publication.

Queues:

- `queueforge.requests`
- `queueforge.webhooks`
- `queueforge.notifications`

Important event types include:

- `request.queued`
- `webhook.delivery.requested`
- `notification.requested`

Inspect:

- `packages/contracts/src/constants.ts`
- `packages/persistence/src/stores/outbox.store.ts`
- `packages/persistence/src/entities/event.entities.ts`
- `apps/worker/src/services/outbox-dispatcher.service.ts`
- `apps/worker/src/services/queue-runtime.service.ts`
- `apps/worker/src/core/jobs.ts`

### G. Durable request execution, retry and recovery

The request worker accepts at-least-once delivery, checks durable processed-event receipts, transitions queued work to processing, executes the immutable processor settings, records global and per-retry-cycle attempt counters, persists progress, and commits success or failure. Failures retry inside the immutable budget. Exhaustion creates a separate dead-letter record. An authorized manual retry returns the request to the queue without deleting or renumbering historical attempts.

Inspect:

- `apps/worker/src/services/request-job-handler.service.ts`
- `apps/worker/src/services/request-executor.service.ts`
- `packages/persistence/src/stores/request-execution.store.ts`
- `packages/persistence/src/stores/processed-event.store.ts`
- `packages/domain/src/retry-policy.ts`
- `packages/domain/src/state-machine.ts`
- `packages/persistence/src/stores/operations.store.ts`

The outbox itself also preserves a lifetime monotonic attempt sequence while resetting only the manual-retry budget for a new generation.

### H. Signed result delivery and notifications

Success can create immutable webhook-delivery and notification work. The webhook worker validates tenant/event binding, decrypts the versioned signing secret, signs canonical bytes, blocks redirects, enforces allowed local destinations, delivers the event, and records every attempt. The included local receiver independently verifies the signature and deduplicates stable event IDs. Notification delivery uses its own durable receipt path.

Inspect:

- `apps/worker/src/services/webhook-job-handler.service.ts`
- `apps/worker/src/security/webhook-http-client.ts`
- `apps/worker/src/security/webhook-signing.ts`
- `apps/worker/src/services/notification-job-handler.service.ts`
- `packages/persistence/src/stores/webhook-delivery.store.ts`
- `packages/persistence/src/stores/webhook-secret.store.ts`
- `apps/webhook-sink/src/sink-server.ts`
- `apps/webhook-sink/src/signature.ts`

### I. Read models, correlation, audit and manual recovery

Request detail, delivery activity, notifications, processing health, and activity history expose the correlated durable state. Authorized users can inspect and retry exhausted work without erasing the prior history.

Inspect:

- `apps/web/src/features/requests/request-detail-screen.tsx`
- `apps/web/src/features/requests/request-detail-timeline.ts`
- `apps/web/src/features/webhooks/webhooks-screen.tsx`
- `apps/web/src/features/notifications/notifications-screen.tsx`
- `apps/web/src/features/operations/operations-screen.tsx`
- `apps/web/src/features/audit/audit-screen.tsx`
- `apps/api/src/controllers/operations.controller.ts`
- `packages/application/src/operations.service.ts`
- `packages/persistence/src/stores/read-model.store.ts`
- `packages/persistence/src/stores/audit.store.ts`

### J. Separate inbound signed-webhook path

Inbound external events use a route-specific raw-body boundary. QueueForge validates request size, timestamp skew, endpoint/key, HMAC, nonce lifetime, and replay state before parsing JSON or mutating durable business state.

Inspect:

- `apps/api/src/controllers/webhook.controller.ts`
- `packages/application/src/inbound-webhook.service.ts`
- `packages/persistence/src/entities/webhook.entities.ts`
- `tests/integration/inbound-webhook-security.spec.ts`

## 7. Request lifecycle

The centralized state machine permits this business lifecycle:

```text
received
├─ validation_failed
├─ pending_approval
│  ├─ approved → queued
│  ├─ rejected
│  └─ cancelled
└─ queued
   ├─ cancelled
   └─ processing
      ├─ succeeded
      └─ failed
         ├─ queued for an automatic retry
         └─ dead_lettered → queued through authorized manual retry
```

Authority:

```text
<REPO_ROOT>\packages\domain\src\state-machine.ts
```

## 8. Role-specific workspaces and permissions

Primary UI policy files:

- `apps/web/src/components/workspace-access.ts`
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/workspace-route.tsx`

Current user-facing workspaces:

- Administrator: Home, Request types, Delivery connections, People & access, Processing health, Activity log, Notifications.
- Operator: Home, Start & track requests, Processing issues, Delivery activity, Notifications.
- Approver: Home, Approval inbox, Notifications.
- Viewer: Home, Request history, Request types, Notifications.
- Platform Administrator: treated as Administrator after selecting an authorized tenant.

Important permission semantics:

- Approver and Operator are lateral roles; one does not inherit the other.
- Administrator has a server-side break-glass superset, while its navigation stays focused on configuration and governance.
- Request detail is a shared deep-link dependency where policy permits it.
- Forbidden route components do not mount, so they do not issue unauthorized background queries.
- Seeded demo memberships are role-locked.
- Backend membership updates also prevent self-edit, no-op changes, stale changes, and demotion of the final active tenant administrator.
- Server-side application authorization and tenant-scoped stores are authoritative. Hiding a UI link is never the security boundary.

## 9. Repository layout

### Applications

```text
apps/api             Nest REST + GraphQL API, auth, health, OpenAPI, inbound webhook boundary
apps/worker          Outbox dispatcher and BullMQ consumers
apps/web             Next.js static-export product interface
apps/webhook-sink    Local signed receiver and controlled demo failure surface
```

Entrypoints:

- `apps/api/src/main.ts`
- `apps/worker/src/main.ts`
- `apps/web/app/layout.tsx`
- `apps/web/app/page.tsx`
- `apps/webhook-sink/src/main.ts`

### Shared packages

```text
packages/contracts       Zod transport/event contracts and shared constants
packages/config          Validated environment schemas
packages/domain          Pure state machine, validation, canonicalization and retry rules
packages/persistence     TypeORM entities, migrations, stores, seed and database CLI
packages/application     Use cases, authorization and orchestration
packages/observability   Structured logging, redaction and Prometheus metrics
packages/ui              Accessible QueueForge React primitives
packages/testkit         Synthetic test helpers
```

Logical dependency direction:

```text
contracts → config/domain → persistence → application → API/worker
ui → web
testkit → tests
observability → backend processes
```

### Persistence

- Entities: `packages/persistence/src/entities`
- Migrations: `packages/persistence/src/migrations`
- Stores: `packages/persistence/src/stores`
- Seed: `packages/persistence/src/seed.ts`
- CLI: `packages/persistence/src/cli.ts`
- Data source: `packages/persistence/src/data-source.ts`

Tracked migrations, in order:

1. `1700000000000-initial-schema.ts`
2. `1700000001000-notification-reads.ts`
3. `1700000002000-approval-decision-command.ts`
4. `1700000003000-security-event-correlation.ts`
5. `1700000004000-inbound-receipt-runtime-lock.ts`
6. `1700000005000-membership-role-lock.ts`
7. `1700000006000-request-attempt-sequence.ts`
8. `1700000007000-outbox-attempt-sequence.ts`

### Infrastructure and local distribution

- `compose.yaml`
- `compose.test.yaml`
- `docker/Dockerfile.node`
- `docker/Dockerfile.web`
- `docker/nginx/default.conf`
- `docker/nginx/nginx.conf`
- `docker/postgres/001-create-runtime-role.sh`
- `START-QUEUEFORGE.cmd`
- `STOP-QUEUEFORGE.cmd`
- `scripts/start-local.ps1`
- `scripts/stop-local.ps1`
- `scripts/generate-env.ps1`
- `scripts/package-private-demo.ps1`

### Tests and evidence

- Backend/package unit tests: colocated `*.spec.ts` files.
- Web unit/component tests: colocated `*.test.ts` or `*.test.tsx` files.
- PostgreSQL/Redis integration tests: `tests/integration`.
- Full role-aware browser journey: `tests/e2e/queueforge-journey.spec.ts`.
- Playwright config: `tests/e2e/playwright.config.ts`.
- k6 load contract: `load-tests/queueforge.spec.ts`.
- Accessibility suite: `apps/web/src/test/control-desk.a11y.test.tsx`.
- Storybook: `apps/web/.storybook` and `apps/web/src/stories`.
- Runtime evidence: selected files under `artifacts` and `test-results/k6`.

## 10. Technology baseline

- Node engine: `>=24.13.0 <25`; workspace/Docker pin uses Node `24.19.0`.
- pnpm: `11.23.0`.
- TypeScript: `5.9.3`.
- Next.js: `16.3.2`, App Router, static export.
- React and React DOM: `19.2.8`.
- NestJS: `11.2.1`.
- Express: `5.2.1`.
- REST, Apollo GraphQL, and generated OpenAPI.
- TypeORM: `1.1.0`.
- PostgreSQL: `17.11-alpine`.
- Redis: `8.6.5-alpine`.
- BullMQ: `6.2.0`.
- Zod, Ajv, React Hook Form, TanStack Query/Table, Recharts, Lucide, and QueueForge-owned UI primitives.
- Nginx `1.29.5-alpine` for the packaged static web artifact.
- Jest, Vitest, Testing Library, axe-core, Playwright, and k6.
- GitHub Actions, Dependabot, and CodeQL configuration already exist under `.github`.

Root manifests/configuration:

- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `.nvmrc`
- `tsconfig.base.json`
- `eslint.config.mjs`
- `jest.config.cjs`

## 11. Runtime URLs and seeded synthetic identities

Loopback-only URLs:

- Web: `http://127.0.0.1:3100`
- API/OpenAPI: `http://127.0.0.1:3001/api/docs`
- GraphQL: `http://127.0.0.1:3001/graphql`
- API readiness: `http://127.0.0.1:3001/api/v1/health/ready`
- Local receiver history: `http://127.0.0.1:3300/history`

Seeded identities:

- `admin@queueforge.test`: platform administrator; tenant administrator in Acme and Beta.
- `operator@queueforge.local`: Acme operator.
- `approver@queueforge.local`: Acme approver.
- `outsider@queueforge.local`: Beta operator only.

They use the locally generated `BOOTSTRAP_ADMIN_PASSWORD`. Never read its value into chat, place it in this prompt, commit it, show it in a screenshot, or upload it. The next operator can obtain it from their own ignored local `.env` only when they are authorized to run the local demo.

The seeded `expense_review` request type requires Amount, Cost Center, and Summary, requires a separate approval, prevents self-approval, then processes, creates a notification, and delivers a signed result to the seeded local receiver.

## 12. Normal project commands

Customer-friendly private start/stop:

```text
START-QUEUEFORGE.cmd
STOP-QUEUEFORGE.cmd
```

Host-first development:

```powershell
pnpm install --frozen-lockfile
pnpm env:generate
pnpm dev:services
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Full local profile:

```powershell
docker compose --profile full up --build
docker compose --profile full down
```

Main quality gates:

```powershell
pnpm verify
pnpm verify:local
pnpm test:a11y
pnpm test:e2e
pnpm test:load:smoke
pnpm audit:local
pnpm verify:release
```

Private packaging:

```powershell
pnpm package:private
```

The packaging script requires a clean Git working tree and creates a revision-suffixed ZIP under `dist`. It uses tracked Git content, excludes `test-results`, and must not include `.env`, dependencies, Git metadata, or generated build/runtime state.

## 13. CI and repository automation already present

Inspect:

- `.github/workflows/ci.yml`
- `.github/dependabot.yml`

The defined CI covers:

- Formatting, linting, type checking, builds, unit tests, integration tests, secret scanning, dependency audit, accessibility, and Storybook.
- A disposable browser topology for the role-aware Playwright journey and bounded k6 smoke.
- CodeQL JavaScript/TypeScript analysis.
- A separate fail-closed public-exposure security gate.

There was no remote CI run at handoff preparation because no Git remote existed. Do not claim GitHub CI passed until the newly created repository actually runs it.

## 14. Security and release boundary

Current gate file:

```text
<REPO_ROOT>\scripts\next-security-gate.json
```

At the `2026-08-25` handoff snapshot:

- Installed Next.js was `16.3.2`.
- The tracked gate was `open` because the vendor had announced an embargoed critical security release expected on `2026-08-26` but had not yet published a confirmed fixed version or full advisory.
- The app therefore remained loopback-only and intentionally not deployed to Vercel or another public host.

If this has changed by the time you inspect the project, verify current official vendor/registry evidence and the repository gate rather than relying on the date in this prompt. Do not remove, bypass, or mark the gate mitigated without the documented official evidence and a full regression/security rerun.

Creating a GitHub source repository is not the same as publicly deploying the running application. The deployment limitation must not be misreported as a source-repository failure.

## 15. Honest claims and non-claims

Supported claims:

- Transactional PostgreSQL outbox.
- At-least-once queue processing.
- Durable deduplication of QueueForge-owned PostgreSQL effects.
- Stable event IDs and receiver deduplication in the included local sink.
- Application/store tenant scoping plus composite tenant-aware PostgreSQL foreign keys.
- Immutable active workflow/request-type versions.
- Explicit request state machine and append-only attempt/transition history.
- Correlated structured logs, audit events, delivery attempts, and security events.
- Signed outbound webhooks and nonce/timestamp-protected inbound verification.
- Role-aware UI plus server-side authorization.
- Real PostgreSQL/Redis, Playwright, accessibility, crash-recovery, and bounded k6 proof in the repository.

Do not claim:

- Exactly-once BullMQ execution.
- Exactly-once delivery to an arbitrary HTTP receiver.
- PostgreSQL row-level security.
- Cryptographically immutable audit logs.
- Public production/cloud readiness.
- A green remote CI run before GitHub actually runs it.
- That a screenshot proves transaction atomicity, HMAC bytes, database constraints, or idempotency.

## 16. Evidence status

Tracked representative UI evidence already exists at:

```text
<REPO_ROOT>\artifacts\screenshots
```

The new numbered walkthrough in `docs/project-handoff/queueforge-pipeline-walkthrough` is the most useful visual orientation for the current role-based UX.

Tracked verification files exist under:

- `artifacts/verification`
- `test-results/k6`

Some older claims/resource/k6 evidence is revision-bound to earlier commits. Treat it as historical proof for the revision written inside each JSON file, not automatically as proof for the latest handoff commit. Source, current tests, and the current revision-suffixed ZIP take precedence.

The browser journey is especially important because it uses distinct identities for administration, operator submission, and approval; covers immutable activation, idempotent replay, tenant isolation, signed delivery, notification/audit visibility, automatic recovery, dead-letter handling, and manual retry; and performs exact fixture cleanup.

## 17. Tracked source versus local/generated material

Expected source/control content:

- `.github`
- `.ultraplan`
- `apps`
- `packages`
- `docs`
- `design-system`
- `docker`
- `scripts`
- `tests`
- `load-tests`
- selected `artifacts`
- selected `test-results/k6`
- root manifests, configuration, launchers, README, license, and lockfile

Never include local/generated material merely because it exists on disk:

- `.env` or any real environment override
- `node_modules`
- `.next`, static `out`, or package/root build `dist` directories
- `output`
- Playwright browser state, traces, reports, and `.playwright-cli`
- coverage output
- `.tools`
- local logs
- Docker volumes, databases, images, caches, or container state
- local Git authentication material

`.env.example` is the source-controlled template. The ignored `.env` contains active generated credentials and is never handoff content.

## 18. Known context and cautions

- The preserved local Acme database contains older synthetic load-test history. Seed is idempotent, not a destructive reset.
- Do not delete or reset Docker volumes merely to make screenshots look cleaner.
- Numbered screenshots contain synthetic IDs and emails but no credentials.
- The local sink is intentionally a bounded demonstration receiver, not a dynamic production destination registry.
- Full Compose static web output is compiled for loopback API URLs and is currently a private/local distribution.
- Role-focused navigation does not narrow the authoritative server permission model by itself.
- The private ZIP is for distribution/inspection. The current Git source tree is the authoritative project.
- Old ZIPs may remain in `dist`; select only the filename whose suffix matches current Git `HEAD`.

## 19. Final objective for this handoff

After inspecting the numbered screenshots, repository documentation, source boundaries, Git state, current revision-matched private ZIP, and security/release notes above, create the GitHub repository for the complete existing QueueForge project using your established normal workflow for this user.

Preserve the project exactly as delivered. Do not invent missing product behavior, redesign the interface, copy ignored local secrets/runtime state, or claim public deployment/remote CI evidence that does not yet exist. If repository visibility or another external choice is not already established in the user’s GitHub workflow, resolve that choice with the user rather than guessing.
