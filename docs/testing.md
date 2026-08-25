# QueueForge testing guide

## Testing philosophy

QueueForge's most important claims cross process and storage boundaries. The test strategy therefore separates:

- pure invariants and adapters that can be proven in-process;
- browser/component behavior that needs a DOM and accessibility engine;
- PostgreSQL/Redis behavior that must run against the real services;
- full browser journeys that exercise the static web app, API, worker, and sink;
- load checks that measure a named local environment rather than inventing capacity claims.

A configured script or test file is not evidence of a passing run. Record the exact command, date, commit, environment, and artifact before using a result in a README, demo, or interview.

## One-time setup

```powershell
corepack enable
corepack prepare pnpm@11.23.0 --activate
pnpm install --frozen-lockfile
pnpm env:generate
```

Start the isolated PostgreSQL and Redis fixtures for integration suites:

```powershell
pnpm test:services
```

The root integration wrappers load `.env`, build persistence, map `TEST_DATABASE_URL` and `TEST_MIGRATION_DATABASE_URL` onto the runtime migration variables, apply migrations idempotently with `scripts/prepare-test-database.ps1`, and then start Jest. The Jest setup selects `TEST_REDIS_URL` and forces `NODE_ENV=test` and `APP_MODE=test`.

## Command matrix

| Command                 | Scope                                                                           | External services                                                            |
| ----------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm format:check`     | Prettier conformance                                                            | None                                                                         |
| `pnpm lint`             | ESLint, React hooks, Next, and accessibility lint rules                         | None                                                                         |
| `pnpm typecheck`        | TypeScript across all workspace packages                                        | None                                                                         |
| `pnpm test:unit`        | Jest/Vitest package tests                                                       | None by default; optional worker Redis probe if `TEST_REDIS_URL` is exported |
| `pnpm test:contract`    | Shared Zod schema, envelope, constants, and header contract suite               | None                                                                         |
| `pnpm test:web`         | Vitest + Testing Library web behavior                                           | None                                                                         |
| `pnpm test:a11y`        | axe-based control-desk component checks                                         | None                                                                         |
| `pnpm test:integration` | Real PostgreSQL/Redis persistence, concurrency, recovery, and webhook probes    | Test Compose services                                                        |
| `pnpm test:db`          | Integration files whose names contain `database`                                | Test PostgreSQL                                                              |
| `pnpm test:security`    | Integration files whose names contain `security`                                | Test PostgreSQL/Redis as used by suite                                       |
| `pnpm build`            | All buildable workspace packages, including static Next export                  | None after install                                                           |
| `pnpm verify`           | Format, lint, typecheck, unit, and build                                        | See unit note                                                                |
| `pnpm verify:local`     | `verify`, integration, and web suites                                           | Test services                                                                |
| `pnpm verify:release`   | Local gate, accessibility, E2E, load smoke, audits, then the Next security gate | Full documented fixtures                                                     |

Root integration/database/security, E2E, and load commands use `scripts/run-with-env.ps1`, which loads missing process variables from the root `.env` without printing them. Existing process variables take precedence; use a clean terminal when investigating unexpected configuration.

The release script composes gates but does not orchestrate the application topology. Its E2E and load stages require an already migrated, seeded web/API/worker/sink instance, as described below; otherwise they fail rather than silently skipping.

## Unit and component coverage map

### Contracts and domain

- strict tenant context, bounded pagination, stable event/correlation IDs, bounded error codes;
- ordered workflow target validation and unique positions;
- request transition matrix and explicit manual retry;
- canonical JSON/hash stability and principal-bound idempotency fingerprint;
- JSON-schema validation without coercion;
- bounded retry/jitter and sanitized audit metadata.

### Application, API, and persistence

- lateral approver/operator roles do not inherit each other;
- Argon2 seed/login compatibility and session-family validation;
- public/Bearer/ApiKey guard routing and API-client tenant replacement;
- trusted-origin, secure refresh/CSRF cookie, and double-submit enforcement;
- REST/GraphQL error mapping, status semantics, and internal-error redaction;
- explicit structured-log redaction paths for authorization, cookies, idempotency, CSRF, webhook signatures, and REST/GraphQL credential fields;
- request idempotency replay headers and GraphQL depth/alias/complexity limits;
- inbound webhook verification occurs before JSON parsing;
- AES-GCM secret binding and tamper rejection;
- isolation-specific bounded retry for transient SQLSTATE failures, including `READ COMMITTED` row-lock/uniqueness public commands;
- workflow activation hash includes ordered targets;
- migration text includes tenant, immutability, append-only, and DLQ controls.

### Worker and sink

- deterministic bounded backoff and job IDs;
- target scheme/host/private-network/DNS policy;
- pinned HTTP delivery, redirect rejection, signature canonicalization;
- outbox publish acknowledgement, retry, expired-lease recovery, and graceful shutdown;
- processed-event replay short-circuit and terminal receipt handling;
- request/webhook attempt recovery and dead-letter paths;
- notification terminal receipt behavior;
- sink signature, clock, body, failure injection, deduplication, and production control lockout.

### Web

- accessible sortable/filterable tables and filtered-empty announcements;
- offline, forbidden, and GraphQL-forbidden query states;
- workflow target/enabled-state autosave and explicit conflict recovery;
- new-versus-existing membership input policy;
- delivery lifecycle schema;
- axe scan of representative control-desk components.

Storybook provides isolated states for shared controls, request table, audit timeline, approval card, webhook delivery, and queue health. It is a review surface, not an authorization or integration test.

## PostgreSQL and Redis integration coverage

Current integration files exercise:

| File                                    | Core probes                                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `database-schema.spec.ts`               | Authoritative migration, `synchronize: false`, cross-tenant FK rejection, active workflow/target immutability, runtime history privileges |
| `database-concurrency.spec.ts`          | Concurrent idempotent submission, one approval decision, disjoint `SKIP LOCKED` outbox claims                                             |
| `persistence-public-surfaces.spec.ts`   | Workflow create/save/activate/clone targets, tenant membership administration, atomic cancel/retry, encrypted webhook endpoint management |
| `inbound-webhook-security.spec.ts`      | Bad/stale signature rejection, nonce replay blocking, signed retry deduplication                                                          |
| `webhook-delivery-security.spec.ts`     | Stable signed bytes, retryable 503, terminal delivery receipt                                                                             |
| `worker-recovery.spec.ts`               | Interrupted request exhaustion, webhook recovery, stable replay generation                                                                |
| `worker-process-crash-recovery.spec.ts` | Forced worker-process termination after a PostgreSQL claim, natural BullMQ stall recovery, terminal receipt and attempt-ledger proof      |
| `redis-queue-runtime.spec.ts`           | Deterministic BullMQ job deduplication and complete worker/queue connection drain                                                         |

Integration tests reset only their own tenant-scoped fixtures. The dedicated service project is `queueforge-test`; it does not reuse the development database.

## Test service lifecycle

```powershell
pnpm test:services
pnpm test:integration
pnpm test:services:down
```

When a completely clean synthetic database is required:

```powershell
pnpm test:services:reset
pnpm test:services
pnpm test:integration
```

`test:services:reset` is destructive. It inspects the exact `queueforge-test-postgres` volume and refuses removal if the `com.queueforge.scope=synthetic-test-only` label is missing. Do not substitute a broad volume name, glob, or unrelated Compose project.

## End-to-end testing

The Playwright configuration connects to an already-running local topology; it does not start the applications. Use a host-first or full demo instance that is migrated, seeded, and ready. The current serial Desktop Chrome journey uses only synthetic identities and covers:

- platform-admin tenant creation and local user/membership creation;
- tenant switching and visible cross-tenant request denial;
- workflow creation, autosave of schema/policy/targets, and immutable activation;
- visible request submission and distinct-principal approval;
- injected processor failure followed by bounded recovery;
- signed outbound webhook arrival at the real local sink;
- correlated audit lookup and identical idempotent UI replay;
- attempt exhaustion, dead-letter visibility, and manual retry.

Run through the root wrapper:

```powershell
pnpm test:e2e
```

The suite writes its HTML report to `tests/e2e/playwright-report/e2e`, test output to `tests/e2e/test-results/e2e`, and retains trace/video on failure. It attaches three real successful-state screenshots to the report rather than checking fabricated images into the README. Do not describe E2E as passing unless the run artifact records success for the checked-out revision.

## CI status and local evidence

`.github/workflows/ci.yml` declares commit-pinned GitHub Actions jobs for quality/integration and a real loopback browser journey with bounded k6 smoke. `.github/workflows/codeql.yml` owns the standalone JavaScript/TypeScript security scan so unrelated jobs cannot mislabel a successful scan. `.github/workflows/exposure-gate.yml` is callable by a future deployment workflow and runs on pull requests that change the tracked frontend dependency or gate policy. The configured coverage includes exact dependency install, build-before-analysis, format/lint/typecheck, unit/build, accessibility, Storybook, owner/runtime-role database setup, migration, integration, dependency/secret/evidence scans, Playwright, and a pinned k6 container. The jobs inject disposable database/Redis URLs and mask every generated ephemeral secret before later steps receive it; `scripts/run-with-env.ps1` accepts that injected CI environment when no local `.env` exists.

The public-exposure workflow and `verify:release` are intentionally nonzero while `scripts/next-security-gate.json` remains open. That is a deployment block, not a flaky test to bypass; ordinary documentation and loopback engineering checks do not claim exposure readiness.

The existence of that workflow is not a remote-green claim. Until a real GitHub run is linked, say **CI configured; remote status not verified**.

For local evidence, preserve:

- command and exit code;
- UTC start/end timestamps;
- clean Git commit for release evidence (ad hoc debugging may explicitly note an uncommitted tree);
- Node/pnpm/Docker versions;
- test report, coverage, trace, screenshot, or k6 summary generated by the tool;
- relevant service logs with secrets and payloads redacted.

Do not hand-edit a result file to make a failing run look successful.

## Failure triage order

1. Confirm `.env` exists and run `scripts/verify-environment.ps1`.
2. Confirm `queueforge-test` PostgreSQL and Redis are healthy.
3. Re-run the narrowest failing suite once with the same configuration.
4. Read the first causal failure, not only downstream snapshot/type errors.
5. Preserve correlation IDs and safe logs; never paste cookies, bearer tokens, HMACs, or `.env` values.
6. Reset only the labeled synthetic test volume if schema/fixture state is the proven cause.
7. Expand to `pnpm verify:local` only after the narrow suite is green.

Operational symptoms and commands are cataloged in [troubleshooting](troubleshooting.md).

## Release blockers

Stop a promotion claim for any cross-tenant disclosure, duplicate committed domain effect, invalid approval/token replay, lost committed outbox work, accepted forged/replayed webhook, secret leakage, broken keyboard/a11y critical path, resource-budget breach, or open critical dependency gate.

`pnpm security:next-gate` is intentionally nonzero while `scripts/next-security-gate.json` remains open. It runs last inside `pnpm verify:release` and may also be inspected directly. Do not remove or bypass it to make a release command appear green.
