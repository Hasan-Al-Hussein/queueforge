# QueueForge demonstration script

## Purpose

This walkthrough shows the system's engineering story in about eight minutes: tenant isolation, role separation, immutable workflow configuration, durable async processing, signed delivery, and correlated operations. It uses only the seeded synthetic data.

Do not present it as a production deployment, exactly-once system, benchmark, or closed security review. The Next.js security gate remains open and the demonstration must stay on loopback.

## Preflight

Use host-first development for the optional failure-injection segment:

```powershell
pwsh -NoProfile -File scripts/verify-environment.ps1
pnpm env:generate
pnpm dev:services
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Wait for:

- <http://127.0.0.1:3001/api/v1/health/ready> to return ready;
- <http://127.0.0.1:3300/health> to return ok;
- <http://127.0.0.1:3100> to render the login screen.

Read `BOOTSTRAP_ADMIN_PASSWORD` from your local `.env`; every seeded identity uses that value. Keep `.env`, developer tools, tokens, cookies, and terminal history out of any recorded frame.

Reset expectations before presenting: seed is idempotent, but previously submitted requests remain in the development database. A clean database is optional and destructive; never remove a volume without verifying it is the intended synthetic QueueForge development volume.

## Segment 1: orient the control desk (60 seconds)

Sign in as `admin@queueforge.test`.

Narration:

> QueueForge is a multi-tenant workflow control desk. The browser holds a short-lived access token in memory, while the server rotates an opaque refresh family. PostgreSQL—not Redis—is the authoritative state store.

Show:

1. the selected tenant and role in the application shell;
2. the Acme overview status strip, queue rail, recent requests, and exact-value throughput table;
3. the tenant switcher: switch to Beta Logistics, point out the isolated workflow/request view, then return to Acme;
4. light/dark theme and a visible keyboard focus indicator if time permits.

Do not claim tenant isolation solely from the UI. Explain that application stores scope every lookup and composite tenant foreign keys reject cross-tenant relationships; integration tests are the evidence.

## Segment 2: immutable workflow configuration (60 seconds)

Open **Workflows**, then open `Expense review`.

Show:

- stable key `expense_review` and active version number;
- enabled intake, JSON request schema, approval and self-approval policy;
- ordered processor, webhook, and notification targets;
- the active version's immutable posture and the explicit clone-draft path;
- draft autosave revision/conflict controls if a draft exists.

Narration:

> Activation hashes the complete ordered definition, retires the previous active version, and prevents later content or target mutation. Draft saves use compare-and-swap revision control so two editors cannot silently overwrite each other.

Avoid changing the seeded workflow during the main demo unless you intend to show the complete clone/save/activate path.

## Segment 3: submit as operator (75 seconds)

Sign out, then sign in as `operator@queueforge.local`. Open **Requests** and choose **Submit request**.

Workflow key:

```text
expense_review
```

Payload:

```json
{
  "amount": 1250,
  "costCenter": "OPS-42",
  "summary": "Synthetic incident tooling"
}
```

After submission, show the detail page and say:

> The API committed the request, validation result, transition, idempotency response, audit metadata, and outbox event in one PostgreSQL transaction. It returned before background execution.

Point out the immutable workflow-version binding, request ID, correlation ID, and `pending_approval` transition. The operator cannot approve; this role separation is intentional.

## Segment 4: approve as a separate principal (75 seconds)

Sign out and sign in as `approver@queueforge.local`. Open **Approvals**, locate the request, and approve it with a short synthetic note.

Narration:

> The decision locks the approval task and request, rechecks revision, role, payload hash, and self-approval policy, then appends one decision and the next outbox event. Approvers do not inherit operator commands.

Return to the request detail and refresh until the timeline shows `approved -> queued -> processing -> succeeded`. Processing may finish too quickly to observe every transient state live; the append-only transition history is the reliable evidence.

## Segment 5: signed effects and audit trail (75 seconds)

Sign back in as the admin or operator.

Show:

1. **Webhooks**: delivery event ID, generation, `delivered` state, attempt count, and last HTTP status;
2. <http://127.0.0.1:3300/history>: accepted stable event identity and correlation;
3. **Notifications**: the role-addressed completion notice;
4. **Audit** as admin: the correlated submission/decision/execution trail;
5. **Operations**: queue counts, outbox state, worker heartbeat, and dead letters.

Narration:

> Each delivery signs the exact immutable event bytes with event ID, timestamp, attempt, and a versioned encrypted secret. Receiver deduplication makes a stable replay safe, but arbitrary HTTP delivery remains at-least-once—not exactly-once.

## Optional segment: controlled retry (2-3 minutes)

This segment works only with the host-first development sink. Production-mode/full-Compose sink controls correctly return 403.

In a separate PowerShell terminal, read the control token without printing it and inject one synthetic 503:

```powershell
$controlToken = (Get-Content -LiteralPath .env |
  Where-Object { $_ -like 'SINK_CONTROL_TOKEN=*' } |
  Select-Object -First 1).Split('=', 2)[1]

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:3300/controls/failures `
  -Headers @{ 'x-queueforge-control-token' = $controlToken } `
  -ContentType 'application/json' `
  -Body '{"failNext":1,"statusCode":503,"delayMs":0}'

Remove-Variable controlToken
```

Submit and approve another synthetic expense request. In **Webhooks**, refresh to show an appended failed attempt followed by a later delivered attempt. In sink history, show the injected 503 and subsequent accepted retry sharing one stable event ID.

If timing makes the transient `retry` state hard to catch, use attempt history rather than repeating the injection. Do not lower timeouts, edit database state, or claim a retry that the history does not show.

## Suggested real screenshot capture points

Capture only from a running, seeded instance after readiness succeeds:

1. overview with queue rail and no developer tools;
2. request detail with correlation timeline;
3. workflow editor showing ordered target configuration;
4. webhook delivery panel with attempt status;
5. operations view with queue health and dead-letter empty state;
6. mobile-width navigation or keyboard focus state.

Crop out email if unnecessary, and never include password fields, `.env`, cookies, bearer tokens, signatures, control tokens, or absolute local user paths. Store screenshots only if the repository's artifact policy explicitly permits them. No screenshot should be described as current unless it was captured from the same revision.

## Closing statement (30 seconds)

> QueueForge's value is not a happy-path queue animation. It is the explicit failure model: one authoritative database transaction, replay-aware handoff to BullMQ, durable consumer receipts, immutable version and attempt history, constrained signed webhooks, and enough operational context to explain what happened. The honest limits are equally deliberate: local-only, application-enforced tenancy without RLS, no exactly-once HTTP claim, and an open Next.js dependency gate.

Offer [architecture](architecture.md), [database design](database.md), [event flow](event-flow.md), and [testing](testing.md) as follow-up evidence.

## Fast fallback if a service fails during the demo

- Readiness 503: explain dependency health separation and show safe logs; do not pretend the system is healthy.
- Redis outage: show committed request/outbox state and explain retry after recovery.
- Webhook failure: show attempt/dead-letter history; do not manually mark delivered.
- UI unavailable: use OpenAPI/GraphQL only if they are actually running, then show the architecture and test artifacts.
- Security gate question: state that Next 16.3.2 is loopback-only and `pnpm security:next-gate` intentionally remains open.

An honest degraded demonstration is stronger than an unsupported success claim.
