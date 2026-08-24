# QueueForge environment baseline

**Recorded:** 2026-08-24
**Scope:** local development and recruiter demonstration on the inspected Windows host

This document records the environment used to design QueueForge. It is not a production sizing guide, a benchmark result, or evidence that every verification gate has passed. Final measurements belong under `artifacts/verification/` and must identify the exact commit and command that produced them.

## Inspected host

| Resource         | Observed baseline                                                    |
| ---------------- | -------------------------------------------------------------------- |
| Operating system | Windows 11 Pro, build 26200                                          |
| Processor        | Intel Core i7-1255U, 10 cores / 12 logical processors                |
| Memory           | 15.68 GiB installed; approximately 2.4-2.5 GiB free during discovery |
| System drive     | Approximately 52.25 GiB free during discovery                        |
| Node.js          | 24.13.0                                                              |
| pnpm             | 11.19.0 observed; the workspace pins pnpm 11.23.0                    |
| Docker Engine    | 29.7.2                                                               |
| Docker Compose   | 5.3.1                                                                |
| Git              | 2.49                                                                 |
| PowerShell       | 7.6.4                                                                |

The Docker engine exposed 12 CPUs and approximately 7.59 GiB of memory. Unrelated local containers consumed about 1.22 GiB during discovery and are outside QueueForge's scope: setup, test, and cleanup commands must not stop, delete, or reconfigure them.

## Resource posture

QueueForge is designed for a machine with 16 GB RAM and must remain below these project limits:

- less than 5 GiB of peak QueueForge memory;
- less than 4 GiB of added QueueForge disk use;
- no paid service, cloud account, or GPU;
- synthetic local data only.

Host-first development is the preferred low-memory route: run PostgreSQL and Redis in Docker, and run the API, worker, static web development server, and webhook sink as host Node.js processes. The full Compose demonstration declares explicit memory and CPU caps. Declared caps are not measured peaks; actual usage is a claim only after a named measurement command preserves its process/container and disk evidence.

To keep the footprint predictable, the design deliberately avoids Nx/Turbo background daemons, Testcontainers, Mailpit, and a heavyweight observability stack. Isolated Compose services, in-app or console notifications, structured JSON logs, and Prometheus-format metrics provide the required local evidence with fewer resident processes.

## Local port allocation

Port 3000 was already occupied during discovery, so QueueForge uses the following defaults:

| Service                       | Port | Exposure rule                 |
| ----------------------------- | ---: | ----------------------------- |
| Static-export Next.js web app | 3100 | Loopback only                 |
| Nest API, REST and GraphQL    | 3001 | Loopback only                 |
| Local webhook sink            | 3300 | Loopback only                 |
| PostgreSQL                    | 5432 | Local development access only |
| Redis                         | 6379 | Local development access only |

Before startup, environment verification must detect conflicts instead of terminating the process that owns a port. QueueForge cleanup may target only explicitly named QueueForge Compose projects and volumes.

## Software baseline

The validated architecture selected the following primary versions for the initial exact lockfile:

| Component         |                                     Foundation version |
| ----------------- | -----------------------------------------------------: |
| NestJS            |                                                 11.2.1 |
| TypeORM           |                                                  1.1.0 |
| `@nestjs/typeorm` |                                                 11.0.3 |
| BullMQ            |                                                  6.2.0 |
| Next.js           | 16.3.2, temporary local-only exception described below |
| React             |                                                 19.2.8 |
| TypeScript        |                                                  5.9.3 |

The checked-in `package.json` files and frozen `pnpm-lock.yaml` are authoritative once installation is complete. This table is a discovery baseline, not permission to introduce dependency ranges.

## Runtime modes

### Host-first development

1. Generate local secrets and configuration with `pnpm env:generate`.
2. Start PostgreSQL and Redis with `pnpm dev:services`.
3. Apply migrations and seed synthetic data.
4. Run the Node.js applications with `pnpm dev`.

This route minimizes Docker memory pressure and is the default response when available memory is low.

### Full local demonstration

The `full` Compose profile runs the API, worker, statically exported web app, webhook sink, PostgreSQL, and Redis in capped containers. It exposes the documented published ports on loopback, uses synthetic seed data, and must prove health before a demonstration begins. It is not an internet-facing deployment topology.

### Isolated integration tests

Destructive tests use the explicit Compose project name `queueforge-test` and dedicated test volumes. A cleanup command must resolve and verify those names before removing them. Development volumes and unrelated containers are not test fixtures.

## Security exception: Next.js gate

The foundation currently pins Next.js 16.3.2 while an upstream critical-security patch gate remains open for verification on or after 2026-08-26. This exception permits only loopback implementation and testing of a static export:

- no Next.js Server Actions;
- no Next.js route handlers;
- no public network exposure;
- no statement that the application is secure, complete, production-ready, or exposure-ready.

The exception closes only after `pnpm security:next-gate` verifies the actual vendor advisory and patched range, the patched version is exact-pinned, the lockfile is regenerated, dependency auditing passes, and web, end-to-end, and full regression checks pass. A numeric comparison to 16.3.2 alone is not sufficient evidence.

## Evidence required before release claims

| Gate             | Required proof                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| Environment      | `scripts/verify-environment.ps1` records versions, ports, and headroom in `artifacts/verification/environment.json` |
| Resource budget  | A preserved, named local measurement records process/container peaks and project/image/volume/cache deltas          |
| Reproducibility  | Frozen install and clean-start workflow succeed from a tracked archive                                              |
| Local quality    | `pnpm verify:local` succeeds                                                                                        |
| Vendor security  | `pnpm security:next-gate` succeeds against the applicable vendor advisory                                           |
| Release evidence | `pnpm verify:release` succeeds after the Next.js gate closes                                                        |

Until those artifacts exist, values in this document are inputs and limits rather than test results.
