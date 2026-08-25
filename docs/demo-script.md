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

Every seeded identity uses the local `BOOTSTRAP_ADMIN_PASSWORD`. To copy it to the Windows clipboard without displaying it, run this from the repository root:

```powershell
$demoPassword = (Get-Content -LiteralPath .env |
  Where-Object { $_ -like 'BOOTSTRAP_ADMIN_PASSWORD=*' } |
  Select-Object -First 1).Split('=', 2)[1]

Set-Clipboard -Value $demoPassword
Remove-Variable demoPassword
```

Paste it into the password field with `Ctrl+V`. Keep `.env`, developer tools, tokens, cookies, and terminal history out of any recorded frame.

Reset expectations before presenting: seed is idempotent, but previously submitted requests remain in the development database. A clean database is optional and destructive; never remove a volume without verifying it is the intended synthetic QueueForge development volume.

## Segment 1: orient the admin workspace (60 seconds)

Sign in as `admin@queueforge.test`.

Narration:

> QueueForge gives each role a focused workspace. This administrator configures how work runs and monitors system health, while operators and approvers get separate daily-work screens. PostgreSQL—not Redis—is the authoritative state store.

Show:

1. the `Administrator` badge, **Admin workspace** title, and selected tenant in the application shell;
2. **Administration overview**, **Your next step**, the four-step **How QueueForge works** guide, plain-language status totals, and recent activity;
3. the tenant switcher: switch to Beta Logistics, point out that its configuration and activity are separate, then return to Acme;
4. light/dark theme and a visible keyboard focus indicator if time permits.

Do not claim tenant isolation solely from the UI. Explain that application stores scope every lookup and composite tenant foreign keys reject cross-tenant relationships; integration tests are the evidence.

## Segment 2: configure a request type (60 seconds)

Open **Request types**, then open `Expense review`.

Show:

- the guided **Build the request form** section and its normal labeled questions;
- the approval rule and self-approval protection;
- the readable summary of processing, delivery, and notification steps;
- the stable key `expense_review` and active version under **Version facts**;
- the active version's read-only posture and explicit **Clone new draft** path;
- draft autosave revision/conflict controls if a draft exists.

Keep **Advanced processing JSON** and **Advanced delivery configuration** closed during the normal demo. They are support tools, not the primary editing experience.

Narration:

> Activation hashes the complete ordered definition, retires the previous active version, and prevents later content or target mutation. Draft saves use compare-and-swap revision control so two editors cannot silently overwrite each other.

Avoid changing the seeded workflow during the main demo unless you intend to show the complete clone/save/activate path.

## Segment 3: start a request as the operator (75 seconds)

Sign out, then sign in as `operator@queueforge.local`. Point out the teal **Operations workspace** and that it has no approval or administration pages. Open **Start & track requests** and choose **Start request**.

Select `Expense review`, then fill the generated form:

| Field           | Value                        |
| --------------- | ---------------------------- |
| **Amount**      | `1250`                       |
| **Cost center** | `OPS-42`                     |
| **Summary**     | `Synthetic incident tooling` |

Choose **Start request**. Emphasize that the operator never enters JSON or a technical workflow key.

After submission, show the detail page and say:

> The API committed the request, validation result, transition, idempotency response, audit metadata, and outbox event in one PostgreSQL transaction. It returned before background execution.

Point out **Status**, **Request type**, **Progress**, **What was requested**, and **Progress history**. If the audience wants implementation evidence, expand **Technical record and security details** to show the immutable configuration version, request reference, and correlation reference. The operator cannot approve; this role separation is intentional.

## Segment 4: approve as a separate principal (75 seconds)

Sign out and sign in as `approver@queueforge.local`. Point out the violet **Approval workspace** and that it has no request-submission, processing, or administration pages. Open **Approval inbox**. On **Decisions waiting for you**, locate `Expense review`, read the requester and friendly request summary, choose **Approve**, add a short synthetic note if desired, then confirm with **Approve request**.

Narration:

> The decision locks the approval task and request, rechecks revision, role, payload hash, and self-approval policy, then appends one decision and the next outbox event. Approvers do not inherit operator commands.

Return to the request detail and refresh until **Progress history** shows the request moving from approval through processing to **Completed**. Processing may finish too quickly to observe every transient state live; the time-ordered history is the reliable evidence.

## Segment 5: signed effects and audit trail (75 seconds)

Sign back in as the admin for configuration and audit evidence, or as the operator for daily delivery and recovery work.

Show:

1. **Delivery connections** as admin, or **Delivery activity** as operator: under **Delivery history**, identify the destination, related request type/reference, friendly delivery status, tries, and receiver reply;
2. <http://127.0.0.1:3300/history>: accepted stable event identity and correlation;
3. **Notifications**: the role-addressed update with its request type and reference;
4. **Activity log** as admin: readable actions and summaries, with technical codes available only under **Details**;
5. **Processing health** as admin, or **Processing issues** as operator: plain-language work totals and **Needs attention** recovery items.

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

Start and approve another synthetic expense request. In **Delivery activity** (operator) or **Delivery connections** → **Delivery history** (admin), refresh to show the additional failed try followed by a delivered try. In sink history, show the injected 503 and subsequent accepted retry sharing one stable event ID.

If timing makes the transient `retry` state hard to catch, use attempt history rather than repeating the injection. Do not lower timeouts, edit database state, or claim a retry that the history does not show.

## Suggested real screenshot capture points

Capture only from a running, seeded instance after readiness succeeds:

1. overview with queue rail and no developer tools;
2. request detail with correlation timeline;
3. request-type editor showing the guided form builder and readable step summary;
4. delivery history with destination, related request, and try status;
5. processing-health view with plain-language totals and the **Needs attention** empty state;
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
