# Contributing to QueueForge

QueueForge is a local-first workflow-reliability portfolio project. Contributions should preserve
its tenant, authorization, durability, evidence, and loopback-only boundaries.

## Development setup

1. Use Node.js `>=24.13.0 <25`, Corepack, pnpm `11.23.0`, and Docker Compose v2.
2. Run `corepack enable` and `corepack prepare pnpm@11.23.0 --activate`.
3. Install exact dependencies with `pnpm install --frozen-lockfile`.
4. Generate local-only secrets with `pnpm env:generate`.
5. Start PostgreSQL and Redis with `pnpm dev:services`, then run migrations and the seed before
   starting `pnpm dev`.

Configuration belongs in the ignored `.env`. Never commit credentials, tokens, database or Redis
state, browser state, traces containing sensitive data, or private distribution archives. Report a
suspected vulnerability through [SECURITY.md](SECURITY.md), not a public issue.

## Change expectations

- Preserve the dependency direction from contracts and domain rules toward adapters and transport
  layers.
- Keep tenant context derived from authenticated membership, never from an arbitrary request body.
- Keep activated workflow versions immutable and approval decisions bound to an exact revision.
- Commit domain state, bounded audit data, idempotency results, and required outbox rows atomically.
- Treat BullMQ execution as at-least-once; retain stable event IDs, durable receipts, and replay-safe
  effects.
- Keep outbound webhook targets allowlisted and signed, with redirects and unsafe addresses denied.
- Add focused tests for changed behavior and a regression test for every security or concurrency
  fix.
- Update contracts, migrations, generated clients, documentation, and evidence together when their
  shared behavior changes.
- Report measured failures honestly. Do not edit evidence artifacts to improve a result.

## Pull-request checklist

- [ ] Formatting, linting, type checking, unit tests, builds, accessibility, and Storybook checks pass.
- [ ] PostgreSQL/Redis migration and integration probes pass when persistence or concurrency changes.
- [ ] Browser and bounded k6 checks pass when the role journey or request path changes.
- [ ] No secret, private data, external target, or public-listening address was introduced.
- [ ] Tenant, approval, idempotency, outbox, retry, webhook, and audit invariants remain covered.
- [ ] User-facing behavior, proof limits, and recovery steps are reflected in the README or `docs/`.

The tracked Next.js advisory gate must remain fail-closed. Do not weaken or bypass it to make the
overall workflow green.
