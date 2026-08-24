# Security model

QueueForge is a local-first reference implementation. Its application controls are designed to be
reviewable and testable, but the repository must not be exposed to an untrusted network until every
release gate is green. In particular, the pinned Next.js release remains behind the time-based
vendor security gate documented below.

## Security posture

- PostgreSQL is the source of truth. Tenant-owned tables carry `tenant_id`, composite foreign keys
  preserve tenant binding, and runtime SQL uses an unprivileged application role.
- Browser sessions use short-lived HS256 access tokens plus rotating, hashed refresh tokens. The
  refresh token is `HttpOnly`; a separate cookie/header double-submit token protects cookie-backed
  mutations. Refresh-family reuse revokes the family.
- Authorization uses explicit roles and capabilities. Tenant context comes from a current database
  membership, not a tenant identifier supplied in a request body.
- API clients use a domain-separated HMAC-SHA256 credential hash. The plaintext key is returned once
  when created; an idempotent replay returns the same client metadata with no secret. Revocation is
  checked on each authentication.
- Workflow versions and their ordered targets are immutable after activation. State transitions are
  allowlisted, and approval policy, optimistic revisions, and self-approval rules are enforced in
  the transaction that records the decision.
- Workflow, API-client, webhook-endpoint, tenant, and membership creation; request submission,
  cancellation, and retry; approval decisions; and delivery replay bind idempotency keys to tenant,
  principal, operation, and a canonical request fingerprint. Clone draft, activation, and
  dead-letter retry instead use transactional domain-state handling and do not promise a stored HTTP
  replay response.
- Outbox leases, processed-event receipts, stable BullMQ job IDs, bounded attempts, and terminal
  dead-letter records make duplicate delivery safe for QueueForge-owned database effects and make
  interrupted work recoverable. Receipt and business effects commit in one database transaction;
  arbitrary HTTP receivers must still deduplicate the stable event ID.

## Webhook controls

Inbound webhooks are parsed through a route-specific raw-body boundary. The service validates body
size and timestamp, resolves an enabled tenant endpoint and key, verifies HMAC over
`timestamp.nonce.eventId.idempotencyKey.keyId.rawBody` with timing-safe comparison, and only then parses JSON or mutates durable
state. Nonces and accepted external event/idempotency identities are stored transactionally. Nonce
reuse is rejected; a matching accepted event, idempotency key, and payload retried with a fresh nonce
and recomputed signature returns the durable receipt.

Outbound endpoints receive a random 256-bit signing secret. The initial create response reveals the
secret once; an idempotent replay hides it. Secrets are encrypted with AES-256-GCM using random IVs
and tenant/endpoint/key/version additional authenticated data. Workers sign the exact persisted
payload snapshot, reuse a stable event ID across attempts, disable redirects, resolve the target on
every attempt, and enforce the configured hostname/private-network policy.

The demo configuration intentionally permits loopback and the local `webhook-sink` hostname. Remove
private-network allowances and use a production-grade egress policy before any external deployment.

## HTTP and GraphQL boundary

- Helmet headers, a strict browser origin, credentialed CORS allowlists, request-size guards, route
  throttles, UUID/header validation, and DTO/Zod allowlists run before business logic.
- GraphQL has CSRF prevention, bounded depth/list depth/aliases/complexity, a node limit, production
  introspection disabled, and stack traces suppressed. Application/resolver failures use the shared
  exception mapping; an Apollo error-envelope plugin normalizes all remaining GraphQL errors to a
  bounded public code and adds request and correlation identifiers.
- The API accepts a valid correlation UUID or creates one, creates a request UUID, and returns both
  in headers. That authoritative correlation ID is persisted into requests, audit records, and
  emitted events.
- Internal failures return generic 5xx messages. Structured logging redacts authorization and cookie
  headers, refresh/access/API credentials, passwords, CSRF tokens, idempotency keys, inbound webhook
  signatures, and `Set-Cookie` values.

## Local secrets and data

Run `pnpm env:generate` to create synthetic local secrets. `.env`, traces, coverage, generated test
output, and local tool binaries are ignored. Do not copy the generated credentials into a shared
environment. The seed creates demonstration identities and a local receiver only; it is not a
production bootstrap process.

Avoid logging request bodies or arbitrary workflow payloads. Audit metadata is deliberately bounded
and excludes credentials. Database append-only triggers and runtime-role grants protect audit,
attempt, transition, processed-event, inbound-receipt, and security-event evidence from
application-level update/delete operations. Expiring nonce replay keys and mutable idempotency state
are deliberately not described as append-only history.

## Verification commands

```powershell
pnpm audit:deps
pnpm audit:secrets
pnpm test:security
pnpm security:next-gate
pnpm verify:release
```

`verify:release` fails closed because it includes `security:next-gate`. A local test pass does not
override that vendor gate.

## Open release gate: Next.js

The project pins its frontend dependencies exactly. The local security policy requires a vendor
release dated **2026-08-26 or later** that satisfies the repository's Next.js gate. As of
**2026-08-24**, that date has not arrived, so no qualifying release can be verified. Until the gate
passes, treat QueueForge as loopback-only and do not claim an exposure-ready production release.

When a qualifying release exists:

1. Review the official Next.js release and security notes.
2. Update the exact pins and lockfile without weakening peer or supply-chain checks.
3. Run unit, integration, accessibility, browser, load-smoke, dependency, secret, and security gates.
4. Build and inspect the full production Compose profile.
5. Record the verified version and evidence in the release notes.

## Reporting a security issue

Do not include credentials, raw webhook signatures, database dumps, or tenant payloads in a report.
Provide the affected component, a minimal synthetic reproduction, expected and actual behavior, and
the relevant request/correlation identifiers. Rotate any local secret that may have been disclosed.
