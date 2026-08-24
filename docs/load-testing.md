# QueueForge load testing

## Purpose and claim boundary

QueueForge ships a bounded k6 verification for five real API paths:

1. workflow request submission;
2. durable idempotency replay;
3. paged request listing;
4. two concurrent decisions against one approval task;
5. signed inbound webhook acceptance.

The scenarios test correctness under modest local concurrency and apply latency regression thresholds. They are not a capacity forecast, an internet-scale benchmark, a full worker-drain test, or proof of outbound webhook throughput. The smoke profile's single samples are useful as a release guard but are not statistically meaningful performance measurements.

`scripts/run-k6.ps1` refuses any API target that is not explicit loopback (`127.0.0.1`, `localhost`, or loopback IPv6). The tests mutate synthetic request, approval, replay, outbox, and audit history. Never point them at production or valuable data.

## Tool installation

Install the project-pinned k6 v2.2.0 binary:

```powershell
pnpm k6:install
```

The installer downloads the Windows AMD64 archive from the official Grafana k6 GitHub release, verifies the fixed SHA-256 checksum, and copies only `k6.exe` into the ignored project cache at `.tools/k6/2.2.0`. It does not add k6 to the global `PATH`.

## Required running topology

The runner loads `.env`, but it does not start or seed QueueForge. Before a run:

```powershell
pnpm env:generate
pnpm dev:services
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Wait for <http://127.0.0.1:3001/api/v1/health/ready>. Keep `pnpm dev` running in its terminal and invoke k6 from another PowerShell session.

The scenario uses:

- `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` for setup login;
- `approver@queueforge.local` unless `K6_APPROVER_EMAIL` overrides it;
- Acme's seeded `expense_review` workflow;
- Acme tenant `10000000-0000-4000-8000-000000000001`;
- the seeded endpoint ID unless `K6_INBOUND_ENDPOINT_ID` overrides it;
- `SINK_SECRET` and `SINK_KEY_ID` to sign the inbound raw body.

Secrets are passed through the process environment. The k6 summary must not contain them, and they must never be copied into command arguments, source, screenshots, or shared logs.

## Smoke profile

```powershell
pnpm test:load:smoke
```

The smoke profile runs one iteration of each of the five scenarios with one VU per scenario and a one-minute maximum per scenario. It validates real response status, IDs, state, page bounds, idempotency headers, approval replay convergence, and webhook receipt identity.

Smoke is included in `pnpm verify:release`. A successful smoke run says that the bounded checks and thresholds passed on that named environment; it does not establish sustained throughput.

## Bounded load profile

```powershell
pwsh -NoProfile -File scripts/run-with-env.ps1 `
  pwsh -NoProfile -File scripts/run-k6.ps1 -Scenario load
```

Defaults:

| Scenario                 | VUs | Iterations | Maximum duration |
| ------------------------ | --: | ---------: | ---------------: |
| Request submission       |   2 |         12 |        2 minutes |
| Idempotency replay pair  |   2 |          6 |        2 minutes |
| Request listing          |   2 |         36 |        2 minutes |
| Concurrent approval pair |   2 |          4 |        2 minutes |
| Signed inbound webhook   |   2 |         12 |        2 minutes |

`K6_LOAD_VUS` may be 1-8. `K6_LOAD_ITERATIONS` may be 1-120; the script derives the other scenario iteration counts from that base. Increase them only on a disposable/reseedable local database and record the override with the result.

Example bounded override:

```powershell
$env:K6_LOAD_VUS = '4'
$env:K6_LOAD_ITERATIONS = '40'
try {
  pwsh -NoProfile -File scripts/run-with-env.ps1 `
    pwsh -NoProfile -File scripts/run-k6.ps1 -Scenario load
}
finally {
  Remove-Item Env:K6_LOAD_VUS -ErrorAction SilentlyContinue
  Remove-Item Env:K6_LOAD_ITERATIONS -ErrorAction SilentlyContinue
}
```

Do not raise the hard bounds by editing the scenario merely to produce a larger portfolio number. First define the engineering question, resource headroom, data-reset plan, and stop conditions.

## Thresholds

Both profiles enforce:

| Metric                            | Required threshold |
| --------------------------------- | ------------------ |
| k6 checks                         | `rate == 1`        |
| HTTP request failures             | `rate == 0`        |
| QueueForge correctness errors     | `rate == 0`        |
| Request submission duration       | p95 `< 1500 ms`    |
| Idempotency pair duration         | p95 `< 1500 ms`    |
| Request-list duration             | p95 `< 1000 ms`    |
| Concurrent-approval pair duration | p95 `< 2000 ms`    |
| Signed inbound-webhook duration   | p95 `< 2000 ms`    |

The custom duration trends measure the operation under test; the idempotency and approval values cover their paired calls. A threshold failure makes k6 exit nonzero. Do not remove a threshold after a failure without diagnosing whether the scenario, host contention, database growth, or implementation changed.

## What each scenario proves

### Submission

Creates a unique synthetic expense command and expects HTTP 201, a request ID, and `pending_approval` state.

### Idempotency replay

Posts the same canonical command twice with one key. Both calls must succeed, return the same request ID, and expose `Idempotency-Replayed: false` then `true`.

### Request listing

Reads page 1 with page size 25 and checks the paged envelope and bound.

### Concurrent approval

Creates a pending request, locates its task as the seeded approver, and sends two simultaneous identical decisions with distinct transport keys. Both must resolve to one request with exactly one committed decision result and one replay result.

### Inbound webhook

Signs the exact JSON bytes with `timestamp.nonce.eventId.idempotencyKey.keyId.rawBody`, sends the canonical QueueForge headers, and expects HTTP 202 with the same external event ID, nonduplicate acceptance, and one request ID.

## Result artifacts

Every run writes a timestamped k6 summary:

```text
test-results/k6/smoke-YYYYMMDD-HHMMSS-summary.json
test-results/k6/load-YYYYMMDD-HHMMSS-summary.json
```

Preserve the raw summary together with:

- clean Git commit under test (non-evidence source changes are rejected);
- UTC date/time and exact effective command;
- profile and effective `K6_LOAD_VUS`/`K6_LOAD_ITERATIONS` values;
- [environment baseline](environment.md) or fresh environment probe;
- whether host-first or full Compose was used;
- database seed/reset state and approximate pre-run row volume;
- QueueForge process/container memory and CPU observations;
- relevant API/worker logs with credentials and payloads redacted.

Use an evidence table such as:

| Field                        | Recorded value                |
| ---------------------------- | ----------------------------- |
| Revision                     | _clean commit identifier_     |
| Host                         | _CPU, RAM, OS_                |
| Profile                      | _smoke or load_               |
| VUs / base iterations        | _actual values_               |
| Result                       | _pass/fail from k6 exit code_ |
| p95 trends                   | _copy from raw summary_       |
| Correctness/HTTP error rates | _copy from raw summary_       |
| Peak QueueForge resources    | _named measurement and value_ |
| Artifact path                | _summary/log path_            |

This repository does not publish benchmark numbers in documentation without such an artifact.

## Interpretation

- A clean correctness rate with a latency threshold failure indicates a performance regression or a contended/aged environment; inspect both.
- HTTP failures with correctness failures usually point to auth, rate limit, schema, dependency, or state errors before raw speed.
- Approval failures can be caused by stale seeded state only if fixtures are not unique; the script creates unique request labels and IDs.
- Inbound failures require checking exact raw bytes, clock, nonce, key ID, and the shared signing secret.
- Growing list latency after repeated runs may reflect accumulated synthetic history; record row volume and use a verified disposable reset rather than hiding it.
- Passing the API scenarios does not prove the worker drained every queued request or that every outbound webhook was delivered. Use E2E/recovery evidence for those paths.

## Stop conditions

Abort rather than continue if:

- the target is not loopback or the database contains non-synthetic data;
- available memory threatens the host or breaches the project resource budget;
- authentication/signature failures suggest a secret mismatch;
- error rate is nonzero;
- the queue/dead-letter backlog keeps growing after request generation stops;
- logs expose a credential, signature, cookie, or raw sensitive payload.

Troubleshooting for service health, retries, and cleanup is in [troubleshooting](troubleshooting.md).
