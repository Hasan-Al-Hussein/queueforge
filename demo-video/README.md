# QueueForge editable product film source and records

Preserved on 2026-09-26 from the existing local production. This is the **276-second
(4:36), 8,280-frame, 1920×1080, 30 fps** project with **78 subtitle cues**, not the
rejected 150-second edition. No new video was rendered for this preservation.

- [Companion captions](output/product-demo.srt)
- [September 1 stream/format receipt](output/media-report.json)
- [September 1 loudness receipt](output/audio-loudness-report.json)
- [Narration publication boundary](NARRATION-PUBLICATION-BOUNDARY.md)
- [Project and evidence boundaries](../docs/portfolio-record.md)

The narrated MP4 and ten generated narration MP3 files are deliberately not tracked in
this public branch because redistribution rights for the external voice output were not
established. The original local files were not changed or deleted. Their paths, sizes,
and SHA-256 identities remain in the [publication boundary](NARRATION-PUBLICATION-BOUNDARY.md).

The local MP4 is 30,791,597 bytes with SHA-256
`ef158b729ead5b737ffa1da49a659cf2477aa0cdfce1efa5577546df97ab82a3`.
The published SRT SHA-256 is
`911fcac177b522c3a1335380f92c97600fde268ed7be402ef83d9e7e87189364`.
The repository's older `docs/media/queueforge-product-demo.srt` is a different
published caption artifact; it has not been silently replaced. Nor has the hosted
YouTube file been downloaded or proved byte-identical to this local master.

## Editable production inputs

`remotion/src` contains the ten chapters, composition, scene layouts, typography,
caption presentation, and exact timeline. `remotion/public` retains only the selected
silent browser clips, narration text and caption timings, licensed local fonts, and
thirteen referenced screenshots needed by this composition. The authored 3D asset and
its Blender source remain in the main application's existing asset tree.

`recording` retains the authored local-browser recording scripts, narration and caption
contracts, screenshot-library preparation, and Windows finalization script. Recording
can create users, workspaces, requests, and approvals in a local synthetic runtime;
it is **not** a read-only inspection command. Narration generation uses an external
Edge TTS service. Public redistribution rights for generated voice output were not
established, so generated audio is excluded. None of these operations was run for
preservation.

`normalize-narration-v3.py` is retained as optional production history. The current
composition references local MP3 files that are not part of this public branch. Those
files are required to reproduce the narrated master. Raw browser takes, authentication
state, private metadata, failed attempts, render intermediates, obsolete captions/audio,
and installed tooling are deliberately not published.

## Dependency provenance and future editing

This optional production archive does not change the application's normal workspace
membership or CI build. The exact original root `pnpm-lock.yaml` and
`pnpm-workspace.yaml` are retained under [production-snapshot](production-snapshot/).
They record the environment used by this editor, including Remotion 4.0.518, React
19.2.4 for the media workspace, Node 24, and pnpm 11.23.0. They are historical input
snapshots, **not an instruction to overwrite a newer application's dependency lock**.

To edit/render later, use a separate working branch or copy, review the archived
workspace entry and merge its `demo-video/remotion` importer/dependency closure with
the then-current root lock. The original layout expects the editor at
`demo-video/remotion` with the root pnpm store at `node_modules/.pnpm`. The package's
commands then provide `studio`, `captions`, `render`, `finalize`, and `verify`.
`finalize` and the recorded FFprobe discovery currently target Windows. Browser,
dependency, compositor, and optional Python/Edge TTS prerequisites are not bundled.
Review the applicable service terms before generating or distributing new narration.
Respect the included font licenses and the applicable Remotion/tool licenses when
reusing the production.

No clean dependency installation, current renderer startup, or reconstruction of the
final film from this archive was tested. This preserves editable source and selected
silent source clips, captions, screenshots, and production receipts, not an offline
reinstall package or a promise of bit-identical rendering. The archived narrated
composition cannot render unchanged until cleared replacement audio is supplied.
Never run `render:release`, caption generation, or `verify` against the only local copy
of preserved media: those commands write output files/reports.

## Validation and disclosure

The dated reports are original production receipts for the omitted local master, not
new claims and not substitutes for the media itself. During preservation the local
MP4's stream metadata and hash were checked; its video stream is 276.000 s and AAC
padding makes the container 276.100 s. The reports' loudness values were not remeasured.
A bounded privacy review inspected 82 sampled frames across the fourteen selected source
clips and the local film. The sampled sign-in frames show a masked password field; no
plaintext credential was observed in the sample. This is not a frame-by-frame guarantee,
a full playback review, or new usability approval. The source timeline and referenced
assets were also inspected.

The film shows an authored synthetic demonstration of the localhost application. Some
waits are edited for pacing, and presentation overlays explain the journey. It is not
evidence of live functionality in the browser-only Vercel showcase or of a deployed
LocalGuard-to-QueueForge connector.
