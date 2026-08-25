# Security and responsible-use policy

## Supported version

Security fixes are applied to the current `main` branch and the latest `0.1.x` source release.
QueueForge is a local engineering demonstration rather than a supported hosted service.

## Report a vulnerability privately

Use GitHub's [private vulnerability reporting form](https://github.com/Hasan-Al-Hussein/queueforge/security/advisories/new)
for suspected vulnerabilities, exposed sensitive data, or a way to bypass authentication, tenant
isolation, approval binding, idempotency, signed delivery, or durable recovery.

Include the affected revision, reproducible steps, expected and observed behavior, impact, and the
smallest safe proof of concept. Do not open a public issue containing credentials, tokens, private
data, exploit payloads, or live external targets. The maintainer will assess the report and
coordinate disclosure and remediation through the private advisory.

## Security model

QueueForge is designed for one trusted local machine:

- the web, API, and demonstration sink bind to `127.0.0.1`;
- PostgreSQL and Redis remain private to the local runtime topology;
- authenticated membership determines tenant context and role permissions;
- activated workflow versions are immutable and approval rechecks the exact bound revision;
- PostgreSQL remains authoritative while Redis and BullMQ coordinate replaceable at-least-once work;
- inbound and outbound webhooks use bounded payloads, HMAC verification, replay controls, and strict
  destination policy;
- local secrets belong only in the ignored `.env`; `.env.example` is the public template;
- committed fixtures and demonstrations use synthetic data.

The complete trust boundaries, attack paths, controls, and residual risks are documented in
[docs/security.md](docs/security.md) and [docs/threat-model.md](docs/threat-model.md).

## Safe use

- Keep the standard stack on loopback. It has no supported TLS/public ingress and must not be
  exposed directly to another machine or the public internet.
- Test only systems and webhook receivers you own or are authorized to use.
- Never commit `.env`, real credentials, private business data, database volumes, Redis state, or
  sensitive traces.
- Treat the included delivery sink and failure injector as local demonstration tools.
- Add production identity, TLS, secret management, network policy, backups, observability, release
  signing, and an explicitly supported dependency baseline before adapting the system beyond its
  documented boundary.

Next.js `16.3.2` remains behind the tracked open advisory gate. The gate is intentionally
fail-closed; loopback-only use is mandatory until a vendor-fixed version is validated with a full
regression run.
