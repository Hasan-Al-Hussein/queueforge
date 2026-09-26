# QueueForge portfolio preservation record

Recorded 2026-09-26. This record preserves the implemented engineering work, its historical evidence, and the editable production material behind the portfolio demonstration. It is not a new release certification, a current security assessment, or a backup of a running installation.

## Published source and scope

The remote branches were checked against these exact commits during the preservation audit. Use the commit links when discussing this record; branch tips can change.

| Source                                              | Recorded revision                                                                                                                          | Role                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Full localhost system, `main`                       | [`9c65b9f97e216a2fe46788ac12f4cec7574692d9`](https://github.com/Hasan-Al-Hussein/queueforge/tree/9c65b9f97e216a2fe46788ac12f4cec7574692d9) | Engineering application, tests, documentation, screenshots, and editable 3D asset |
| Public showcase, `codex/queueforge-public-showcase` | [`5f0d74c410a1f8d1c93fe8bdab3f6214092afbbb`](https://github.com/Hasan-Al-Hussein/queueforge/tree/5f0d74c410a1f8d1c93fe8bdab3f6214092afbbb) | Separate browser-only portfolio implementation using synthetic fixtures           |

The full system implements authenticated workflow submission, independent approval, durable processing, signed delivery, and correlated history. PostgreSQL is authoritative; a transactional outbox transfers committed work into Redis/BullMQ processing. Delivery is at least once, and receivers still need idempotent handling. The design does not claim arbitrary exactly-once HTTP delivery, PostgreSQL row-level security, cryptographically immutable audit history, or public-production readiness. See [architecture](architecture.md), [database design](database.md), and [security boundaries](security.md).

The hosted showcase demonstrates the interface, routes, forms, validation, role-specific navigation, search, filters, responsive layouts, and browser interactions. Its records and throughput are synthetic, its actions change browser memory, and a refresh resets that state. It does not connect to real authentication, an API, PostgreSQL, Redis, background workers, durable queues, signed outbound webhooks, or durable audit storage. The Proof Forge animation explains a lifecycle; it is not live worker telemetry. The showcase source remains on its separate published branch.

A proposed LocalGuard-to-QueueForge integration remains future work. This record does not establish a delivered cross-project connector, a live AI decision pipeline, or a verified end-to-end integration between those projects.

## Implemented work and evidence map

The following capabilities have source and test surfaces in the published engineering system. The existence of tests is distinguished from a claim that those tests were rerun for this preservation change.

| Capability                                                                                  | Source and evidence surfaces                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant and role boundaries; rotating sessions and API clients                               | [`packages/application`](../packages/application), [`packages/persistence/src/tenant-scope.ts`](../packages/persistence/src/tenant-scope.ts), [`identity.store.ts`](../packages/persistence/src/stores/identity.store.ts), [database concurrency tests](../tests/integration/database-concurrency.spec.ts) |
| Immutable workflow versions, request binding, independent approval, and idempotent commands | [`packages/domain`](../packages/domain), [`packages/persistence`](../packages/persistence), [database schema tests](../tests/integration/database-schema.spec.ts), [role-based browser journey](../tests/e2e/queueforge-journey.spec.ts)                                                                   |
| Transactional outbox, repeated-delivery handling, retries, leases, and recovery             | [`outbox.store.ts`](../packages/persistence/src/stores/outbox.store.ts), [`queue-runtime.service.ts`](../apps/worker/src/services/queue-runtime.service.ts), [worker recovery tests](../tests/integration/worker-recovery.spec.ts)                                                                         |
| Signed webhooks, replay checks, destination restrictions, and receiver evidence             | [`inbound-webhook.service.ts`](../packages/application/src/inbound-webhook.service.ts), [inbound security tests](../tests/integration/inbound-webhook-security.spec.ts), [delivery security tests](../tests/integration/webhook-delivery-security.spec.ts)                                                 |
| Accessible light/dark product interface and linked operational history                      | [`apps/web`](../apps/web), [`packages/ui`](../packages/ui), [accessibility tests](../apps/web/src/test/control-desk.a11y.test.tsx), [product tour](product-tour.md), [screenshot manifest](media/screenshots/final-e4de0d2-b17918e5/manifest.json)                                                         |
| Authored Attestation Forge 3D asset and its editable construction                           | [`tools/queueforge-3d`](../tools/queueforge-3d), [browser assets](../apps/web/public/3d/queueforge)                                                                                                                                                                                                        |
| Reproducible engineering checks                                                             | [Testing guide](testing.md), [CI workflow](../.github/workflows/ci.yml), [CodeQL workflow](../.github/workflows/codeql.yml), [`load-tests`](../load-tests)                                                                                                                                                 |

The existing [claims receipt](../artifacts/verification/claims.json) and [clean-start receipt](../artifacts/verification/clean-start.json) were recorded on 2026-08-25 against `a6cbfa679ba824454c2c3a96b592a1593f487f8f`. They report the local checks and clean-start journey performed then. The [resource receipt](../artifacts/verification/resources.json) is also historical. All three already existed in published source and matched the older local copies after line-ending normalization; they were not regenerated during this audit.

The [migration CLI incident and closure narrative](evidence/preservation-20260926/migration-cli-failure-2026-08-24.md) preserves an earlier implementation failure, its correction, and the probes recorded at the time. It is a historical engineering note, not a newly reproduced database result. Load results, screenshots, and receipts apply to their recorded revisions, synthetic data, machines, and workloads; they are not capacity guarantees or evidence that a later revision has passed every gate.

## Editable video source and local media record

The preservation set retains the editable [Remotion project](../demo-video/README.md), its TypeScript scenes, timing and caption sources, recording/production scripts, licensed fonts, and the selected media dependencies used by the current composition. This material was absent from both recorded remote branches, although the public README already linked a narrated demonstration and published screenshots.

The canonical local production identified by this audit is the 276-second version, not the earlier 150-second slideshow. Its timeline contains 8,280 frames at 30 fps and its companion subtitle file contains 78 cues.

| Artifact                                                                      | Publication state | Recorded SHA-256                                                   |
| ----------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------ |
| `demo-video/output/product-demo.mp4`                                          | Local only        | `EF158B729EAD5B737FFA1DA49A659CF2477AA0CDFCE1EFA5577546DF97AB82A3` |
| [`demo-video/output/product-demo.srt`](../demo-video/output/product-demo.srt) | Published         | `911FCAC177B522C3A1335380F92C97600FDE268ED7BE402EF83D9E7E87189364` |

The narrated MP4 and ten generated narration MP3 files are omitted from public Git history because redistribution rights for the external voice output were not established. Their originals remain unchanged in local preservation storage. The [narration publication boundary](../demo-video/NARRATION-PUBLICATION-BOUNDARY.md) records exact paths, sizes, and hashes without distributing the media. Fourteen narration-free browser clips, screenshots, captions, timing data, recording scripts, and the editable composition remain published as direct evidence of the work.

A read-only FFprobe check on 2026-09-26 identified H.264 video at 1920 by 1080, 30 fps, 8,280 frames, and 276.000 seconds; AAC audio at 48 kHz mono; a 276.100-second container; and a file size of 30,791,597 bytes. The hashes above were calculated from the preserved local files. These checks establish file identity and reported stream metadata, not full playback quality or a right to redistribute the omitted media.

The [media report](../demo-video/output/media-report.json) and [audio loudness report](../demo-video/output/audio-loudness-report.json) were generated on 2026-09-01. They retain the original production measurements and check results for the omitted local master. They do not establish redistribution rights and are not substitutes for the media itself. No new render, complete playback review, frame-by-frame review, or loudness analysis was performed for this preservation record. A bounded privacy review inspected 82 sampled frames across fourteen source clips and the local film; no plaintext credentials were observed in those samples. The independently read stream metadata agrees with the report's duration, dimensions, frame count, and file size.

The companion SRT above differs from the existing published `docs/media/queueforge-product-demo.srt`, including after line-ending normalization. Preserve each file's provenance; the local video/SRT pair does not by itself establish byte identity with a hosted video or the earlier published captions. Earlier 150-second manifests, rejected edits, intermediate renders, and their contact sheets are not evidence for this 276-second production.

## Selective preservation and privacy

The older local source tree was based on release commit `e4de0d27801d11b031756ca2d09ae05e54cac78c` and contained tracked and untracked changes. Comparing those files with the published revisions showed that most of the apparent redesign work, screenshots, and editable 3D material were already published. That older tree was not used as a replacement for the newer main branch.

Several differing local files were older variants: four application screens, the journey test, font-license notices, design prose, and screenshot/tour manifests. Retaining the published versions avoids undoing later display, test, licensing, and document repairs. The independently identified missing application change was the narrow nginx CSP allowance for the local Meshopt WebAssembly decoder. Source comparison identified that change; this record does not claim a new runtime verification of it.

The media preservation set excludes generated narration MP3s, the narrated local master, raw browser takes and `metadata.private.json`, browser session state, environment files, runtime credentials, private database data, dependency installations, build caches, rejected/intermediate renders, and unrelated projects. Production scripts may require local environment credentials when intentionally recording a fresh synthetic demonstration; those credentials and the resulting private capture metadata are not publication material.

The audit scanned 63 relevant media source/text files for workstation paths and high-confidence private-key/token patterns and found no matches for those patterns. That bounded check is not proof that every possible secret representation or every video frame was reviewed. No private capture metadata or environment values were used as portfolio evidence.

## Runtime state and retirement boundary

This preservation records achievements through source, editable assets, published references, and dated evidence. It intentionally does not export Docker images, containers, volume contents, PostgreSQL dumps, Redis snapshots, WSL distributions, or runtime credentials. Docker and WSL remained stopped and untouched during this work.

There is no offline-runtime restoration claim. The repository describes how to create a fresh local demonstration with newly generated credentials and synthetic fixtures, subject to its documented prerequisites and security gates; it does not restore a previous database, session, queue, or local operating environment. Unique information inside stopped runtime volumes was not inspected. Any later retirement of that state is a separate decision and is not authorized or proven safe by this record.
