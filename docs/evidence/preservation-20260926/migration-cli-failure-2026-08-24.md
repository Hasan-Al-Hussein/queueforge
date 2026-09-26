# Corrected migration CLI failure

- Check: first migration attempt against the isolated `queueforge-test` PostgreSQL service.
- Result: failed before opening a database session.
- Symptom: `TypeError` from `Reflect.getMetadata` while TypeORM loaded `base.entity.ts` through `tsx`.
- Root cause: the esbuild-based TypeScript runtime did not emit the decorator metadata required by the TypeORM entity decorators.
- Database impact: none; `pg_stat_activity` had no competing session and the failure occurred during module loading.
- Correction: migration, revert, and seed commands now build the persistence dependency closure and execute `dist/cli.js` with Node.
- Required proof: rerun the same migration, seed, grants, and constraint probes successfully before closing this evidence item.

## First compiled migration attempt

- Result: the compiled CLI loaded correctly and began the transactional migration.
- Failure: PostgreSQL rejected a foreign key on `request_attempts` because the mistakenly referenced `workflow_version_id` and `payload_hash` columns do not exist on that table.
- Impact: the migration uses an all-or-nothing transaction, so the schema changes rolled back.
- Correction in progress: retain the normal request-attempt FK and place the stronger request/version/payload binding on `approval_tasks`, where those columns exist.

## Closure evidence

- The corrected compiled migration completed successfully on PostgreSQL 17.11.
- The seed completed successfully with two tenants, four users, two active workflow versions, four versioned targets, and the corrected `/webhooks` sink route.
- The runtime role can read audit records but has no audit update privilege.
- An update against an activated workflow target was rejected by the immutability trigger.
- A cross-tenant request/version relationship was rejected by the composite foreign key.
- Follow-up integration tests still need to automate these probes; this incident itself is closed.
