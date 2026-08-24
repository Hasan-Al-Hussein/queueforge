# QueueForge troubleshooting

## First checks

Run the non-disruptive environment probe before changing processes or volumes. It inspects host/service state and writes only `artifacts/verification/environment.json`:

```powershell
pwsh -NoProfile -File scripts/verify-environment.ps1
```

Then inspect QueueForge-owned service state:

```powershell
docker compose -p queueforge-dev ps
docker compose -p queueforge-dev logs postgres redis
```

Do not stop a process merely because it owns a planned port. Identify it first and either change QueueForge's local configuration or deliberately stop it outside this troubleshooting guide.

## Configuration and startup

### `Missing ...\.env`

Interactive root runtime/database/E2E/load wrappers normally fail closed when `.env` is absent. The shared wrapper can instead accept already-injected database variables for CI; the k6 runner still requires the root `.env` file.

```powershell
pnpm env:generate
```

The generator does not overwrite an existing file unless explicitly forced. It creates synthetic random secrets without printing them.

### Environment validation reports missing or malformed fields

Compare field names with `.env.example`. Common causes are a placeholder value, a non-base64 32-byte `WEBHOOK_MASTER_KEY`, an undersized secret, or a URL using the wrong protocol.

`scripts/run-with-env.ps1` fills only process variables that are empty. A stale variable already set in the terminal overrides `.env`. Open a clean PowerShell session or remove only the specific stale process variable, then retry.

### Port already in use

The defaults are 3001, 3100, 3300, 5432, and 6379. Identify the listener without terminating it:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3001,3100,3300,5432,6379 |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

Port 3100 is fixed in the web development command; `WEB_PORT` controls the full-Compose loopback binding. API/sink/database/Redis ports also have environment fields, but dependent public URLs/origins must remain consistent.

### Docker reports unhealthy or unavailable

```powershell
docker info
docker compose -p queueforge-dev ps
docker compose -p queueforge-dev logs postgres redis
```

Start the Docker engine if `docker info` fails. If memory is tight, use host-first development and stop only unrelated software you control; do not delete unrelated containers.

### PostgreSQL password changed but the old volume remains

PostgreSQL initialization variables and the runtime-role script run only when the data directory is first created. Regenerating `.env` does not rewrite credentials inside an existing volume.

For valuable local data, restore the old matching `.env` or change credentials deliberately inside PostgreSQL. For disposable synthetic QueueForge development data only, confirm the exact project and volume before using a volume-removing Compose command. The operation is irreversible and must never target a workspace root, wildcard, or unrelated project.

### Migration permission error

`pnpm db:migrate` uses `MIGRATION_DATABASE_URL` (owner); runtime apps use `DATABASE_URL` (least privilege). Confirm that both point to the same intended local database with different roles and that the Docker initializer created `queueforge_app`.

If the error is from a test, use the `queueforge-test` services and `TEST_*` URLs rather than the development database.

## API health and authentication

### Liveness works but readiness returns 503

`/api/v1/health/live` proves only that the API process responds. `/api/v1/health/ready` probes PostgreSQL and Redis. Inspect both service logs and URLs; do not treat liveness as dependency readiness.

### Login returns CSRF/origin failure

Use the exact configured origin, normally <http://127.0.0.1:3100>. `http://localhost:3100` is a different origin. Login, refresh, logout, and tenant selection validate `WEB_ORIGIN`; CORS also allows only that value with credentials.

### Refresh repeatedly returns 401/403

Check that:

- the browser sends credentials;
- the refresh cookie path is `/api/v1/auth`;
- the readable `qf_csrf` cookie matches `X-CSRF-Token`;
- the request Origin equals `WEB_ORIGIN`;
- `COOKIE_SECURE=false` for plain local HTTP;
- the session family was not revoked by logout, expiry, or token-reuse detection.

The web app restores a session through credentialed refresh and keeps the access token only in memory. Clearing `localStorage` cannot repair auth because QueueForge does not store tokens there.

### `AUTHORIZATION_DENIED` versus `NOT_FOUND`

`AUTHORIZATION_DENIED` means the authenticated role lacks the capability. `NOT_FOUND` is tenant-scoped and may intentionally avoid revealing whether another tenant owns an identifier. Switch to an authorized tenant/role rather than adding client-side tenant headers.

### API key is invalid or revoked

Use `Authorization: ApiKey <credential>` exactly; bearer syntax is for user access JWTs. API keys are revealed once at creation and cannot be reconstructed from the database. A key embeds and authenticates one tenant and has only viewer or operator scope. If it was lost or revoked, a user tenant administrator must create a replacement and update the caller through an approved secret channel.

API-key hashes and refresh-token hashes are keyed by `REFRESH_TOKEN_PEPPER`. Replacing that value while retaining the database invalidates existing credentials/sessions; restore the matching secret or deliberately reprovision them instead of editing hashes.

## Workflows and requests

### Draft autosave reports `STALE_REVISION`

Another save changed the draft revision. The editor presents explicit recovery: load the server revision or keep the local content and retry against the new base. Review JSON schema, processing configuration, ordered targets, enable state, and approval flags before choosing; do not blindly overwrite.

### Workflow activation fails

Confirm the current version is draft, target positions are unique, JSON fields are objects, `preventSelfApproval` is not true while approval is disabled, and no concurrent activation changed the template. Activated content and targets are immutable by database trigger.

### Request returns validation failure

The submission payload must be a JSON object matching the enabled active workflow's exact schema. Seeded Acme `expense_review` requires:

```json
{
  "amount": 1250,
  "costCenter": "OPS-42",
  "summary": "Synthetic local demonstration"
}
```

The schema rejects additional fields. Beta `access_review` requires `system` and `reason`.

### Request remains `pending_approval`

Sign in as an Acme approver or tenant/platform administrator who is not forbidden by the workflow's self-approval rule. An operator cannot decide approvals, and an approver does not inherit operator submission rights.

### Request remains queued or processing

Check:

1. worker process logs and heartbeat;
2. `/api/v1/operations/queues` as operator/admin;
3. Redis health and URL/password;
4. outbox pending/retry/dead counts;
5. request attempt and transition timeline.

Restarting a worker should allow expired leases/stale attempts to recover. Do not manually mutate status rows to make the dashboard move.

### An idempotency key conflicts

Reuse is valid only for the same tenant, principal, operation, and canonical payload. Generate a new key for a semantically different command. On routes with durable binding, an identical committed replay returns the prior result rather than creating another effect; API-client replay intentionally omits the one-time secret. Clone draft, activation, and dead-letter retry use domain-state handling instead of a key. See the exact matrix in [API design](api-design.md).

## Webhooks

### Signing secret becomes unavailable after replacing `.env`

The seeded webhook secret is encrypted under `WEBHOOK_MASTER_KEY`, and the fixed seed row is not overwritten on a later seed run. Replacing `.env` while retaining the development database can therefore make existing ciphertext undecryptable or leave the sink using a different `SINK_SECRET`.

Restore the matching prior `.env` when data matters. For disposable synthetic development data, verify the exact QueueForge Compose project and volume, reset only that data, then migrate and seed again. Re-running seed against the retained row is not key rotation.

### Endpoint creation or delivery says target blocked

Check `OUTBOUND_ALLOWED_HOSTS`, protocol, URL credentials/fragments, and `OUTBOUND_ALLOW_PRIVATE_NETWORKS`. Host-first defaults permit `127.0.0.1`, `localhost`, and `webhook-sink`; the full worker profile narrows the allowlist to `webhook-sink`.

QueueForge resolves and pins an allowlisted address and never follows redirects. Adding a hostname to the allowlist is a security decision, not a generic connectivity workaround.

Endpoint creation reveals its signing secret once as `{ endpoint, signingSecret, replayed: false }`. If the connection fails before it is received, replay the same idempotency key to identify the committed endpoint; the replay returns `{ endpoint, signingSecret: null, replayed: true }`. Disable the uncertain endpoint and create a replacement for the receiver.

The seeded endpoint is the only endpoint preconfigured with the bundled sink's startup secret. For a newly created endpoint, configure the target receiver with the one-time secret before activating a workflow. Use `http://127.0.0.1:3300/webhooks` for host-first execution or `http://webhook-sink:3300/webhooks` when the worker runs inside the full Compose network; the UI intentionally does not guess the runtime profile.

### Delivery is retrying or dead

Inspect the delivery row, latest HTTP status, next-attempt time, attempt count, and safe error. Confirm the sink:

```powershell
Invoke-RestMethod http://127.0.0.1:3300/health
Invoke-RestMethod http://127.0.0.1:3300/history
```

Retryable failures append attempts and back off. Terminal or exhausted delivery becomes `dead`. Manual replay creates a new generation and retains original history.

### Sink failure controls return 403

Mutation controls are deliberately disabled when the sink runs with `NODE_ENV=production`, including the full Compose profile. Use host-first development for the synthetic failure-injection demonstration and authenticate with the generated control token. Do not weaken production-mode control behavior.

### Inbound webhook signature fails

Verify the canonical header names from [event contracts](event-contracts.md), raw bytes, timestamp seconds, nonce length/uniqueness, event ID, idempotency key, key ID, and HMAC input `timestamp.nonce.eventId.idempotencyKey.keyId.rawBody`. HTTP header names are case-insensitive, but their values and the signed bytes are not; re-serializing JSON after signing invalidates the signature.

## Tests

### Integration suite cannot connect

```powershell
pnpm test:services
docker compose -p queueforge-test -f compose.test.yaml ps
```

Test ports are 55432 and 56379. Integration setup prefers `TEST_*` URLs from `.env`. If a clean fixture is proven necessary, `pnpm test:services:reset` verifies and removes only the labeled synthetic test volume.

### Worker Redis probe is skipped or unexpectedly connects

`apps/worker/src/services/queue-runtime.integration.spec.ts` is included by the worker's Jest root despite its name, but it runs only when `TEST_REDIS_URL` is already present in the test process. With no exported value it is skipped. If the value is present, start `pnpm test:services` or remove only that stale process variable when diagnosing unrelated pure logic.

### E2E or load command target is missing

Confirm that the checked-out revision contains `tests/e2e/playwright.config.ts`, the E2E specs, `scripts/run-k6.ps1`, and the referenced `load-tests` scenarios. A package script alone is not a test implementation. Do not report a pass if the command exits because no tests were found.

### `pnpm security:next-gate` fails

This is currently expected. `scripts/next-security-gate.json` remains `open` until the actual upstream advisory, patched version, exact pin, regenerated lockfile, dependency audit, and full regression evidence exist. Keep the application loopback-only; do not bypass the check.

## Safe shutdown and cleanup

Host-first:

```powershell
# First stop pnpm dev with Ctrl+C
pnpm dev:services:down
```

Full profile:

```powershell
docker compose --profile full down
```

Tests:

```powershell
pnpm test:services:down
```

These commands preserve volumes. Remove data only after resolving and verifying the exact QueueForge project/volume and accepting that recovery may not be possible.

## Escalation packet

When a problem remains, capture the narrowest useful evidence:

- exact command and exit code;
- `artifacts/verification/environment.json`;
- QueueForge-owned `docker compose ps` output;
- safe service logs around one correlation ID;
- request/error code and state timeline;
- test name and first causal stack frame;
- whether the tree contains uncommitted changes.

Redact `.env`, authorization/cookie values, HMAC signatures, passwords, webhook secret material, and business payload fields.
