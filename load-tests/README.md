# QueueForge local load verification

`queueforge.spec.ts` exercises five real API paths: request submission, durable idempotency replay,
request listing, concurrent approval decisions, and signed inbound webhook ingestion. Both profiles
require the seeded local database and credentials loaded from `.env`; no secret is embedded in the
script or written to the k6 summary.

- `smoke` runs one iteration of each path and is the release gate.
- `load` defaults to two VUs and twelve bounded base iterations. Override only with
  `K6_LOAD_VUS` (1-8) and `K6_LOAD_ITERATIONS` (1-120).

Every profile requires zero HTTP failures, zero correctness errors, and 100% checks. The p95 limits
are 1 second for list reads, 1.5 seconds for submission/idempotency, and 2 seconds for
approval/webhook work. Runs intentionally create synthetic requests and audit history in the local
test tenant; use a disposable or reseedable local environment, never production data.

Run `pnpm test:load:smoke` after the API is healthy. For the bounded load profile, call
`pwsh -NoProfile -File scripts/run-with-env.ps1 pwsh -NoProfile -File scripts/run-k6.ps1 -Scenario load`.
