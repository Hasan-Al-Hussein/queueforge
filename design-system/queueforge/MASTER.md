# QueueForge design system

**Product:** A private workflow-control workspace for requesters, approvers, operators, and administrators.

**Design thesis:** QueueForge makes every important handoff visible, attributable, and recoverable. The interface should feel like a calm chain-of-custody instrument: precise enough for operators, readable enough for first-time users, and distinctive enough to communicate that proof, not decoration, is the product.

**Art direction:** **The Proof Foundry** uses blackened steel, archival ivory, cool inset steel, engraved rules, sequence marks, receipt stamps, and one controlled burnished-brass signal. Verified outcomes resolve in oxide teal. The product is industrial, precise, and calm, never generic sci-fi or ordinary SaaS.

**Dials:** variance 6/10, motion 5/10, density 6/10. Drama belongs on sign-in and overview; work routes remain compact and task-first.

## Experience principles

1. Lead with the next human task: start, review, recover, configure, or inspect.
2. Keep operational copy literal. The visual system may be expressive; labels such as “Requests,” “Approval inbox,” and “Processing health” must stay plain.
3. Show readable business values before IDs, JSON, queue metadata, or hashes. Technical evidence lives in one deliberate disclosure or detail view.
4. Generate requester forms from the workflow schema. Requesters and approvers never enter JSON.
5. Preserve separation of duty in both permissions and composition: operator, approver, and administrator workspaces have distinct navigation and focused landing actions.
6. Make current state, next action, owner, age, and recovery path obvious before historical detail.
7. Default to light mode, honor an explicit local theme choice, and author both themes as complete material systems.
8. Never trade truth for visual neatness. Counts, retries, states, and delivery evidence come from real application data.

## Signature system: the Proof Spine

The Proof Spine is QueueForge’s product-owned chain-of-custody visual:

1. A request enters as an unstamped record.
2. Intake stamps its validated schema and immutable workflow version.
3. A separate witness mark represents the independent approval decision.
4. Processing records retry strata without erasing earlier attempts.
5. Delivery resolves into a signed seal.
6. One audit filament remains connected across the full journey.

Use the Proof Spine as the focal scene on sign-in and overview, and as lightweight semantic HTML on request detail, workflow topology, and delivery history. Never substitute generic orbs, particle wallpaper, or unrelated 3D decoration.

Critical labels and controls stay semantic HTML. WebGL is an optional desktop enhancement only:

- Load dynamically only after capability checks at widths of at least 768 px; the sign-in version
  also requires a viewport height of at least 600 px so the form remains the first practical task.
- Do not load Three.js or the model for reduced motion, Save-Data, missing WebGL, or initialization
  failure.
- Cap device-pixel ratio at 1.25 and active animation at 30 fps.
- Use the authored 12-second `ProofCycle`: request cassette → intake strike → independent witness
  imprint → retained retry strata → signed receipt, including a readable receipt dwell and a
  concealed reset into the next cycle. Keyboard focus can hold and inspect any semantic stage.
- Pause the clock offscreen or when the document is hidden; dispose every listener, observer,
  mixer, animation, geometry, material, texture, and renderer.
- Keep the model-derived poster and semantic four-stage controls fully usable on mobile, reduced
  motion, Save-Data, and failure fallbacks.

## Material and color system

### Light: archival instrument

| Token          | Value     | Purpose                                        |
| -------------- | --------- | ---------------------------------------------- |
| Canvas         | `#C3C9C7` | Cool-stone workbench beneath archival surfaces |
| Surface        | `#F7F3E9` | Primary archival paper/work surface            |
| Raised         | `#D6DDDA` | Raised interactive cool-steel surface          |
| Strong ink     | `#111B20` | Main structure and headings                    |
| Body ink       | `#304047` | Long-form and operational copy                 |
| Muted          | `#526066` | Secondary copy at accessible contrast          |
| Rule           | `#ADB8B4` | Engraved separators                            |
| Strong rule    | `#74817E` | Structural panel and data boundaries           |
| Control rule   | `#6F7C79` | Inputs and dropdown boundaries                 |
| Primary action | `#111B20` | Stable graphite action with archival text      |
| Task brass     | `#9B6126` | One route-defining task action                 |
| Brand brass    | `#A76524` | Rails, registration marks, and selected states |
| Information    | `#365F9D` | Links, focus, and informational state          |
| Verified proof | `#0B7168` | Completed, healthy, and signed proof only      |
| Warning        | `#8A5A08` | Waiting and retry attention                    |
| Danger         | `#B83B4D` | Failure and destructive confirmation           |

### Dark: blackened instrument

| Token          | Value     | Purpose                                |
| -------------- | --------- | -------------------------------------- |
| Canvas         | `#101A1E` | Cool charcoal workspace                |
| Surface        | `#213239` | Primary graphite work surface          |
| Raised         | `#34464D` | Raised interactive gunmetal surface    |
| Strong ink     | `#F3F1E9` | Main text                              |
| Body ink       | `#C7D0D0` | Long-form and operational copy         |
| Muted          | `#A8B5B7` | Secondary copy                         |
| Rule           | `#40545B` | Engraved separators                    |
| Strong rule    | `#677C83` | Structural panel and data boundaries   |
| Control rule   | `#80949A` | Inputs and dropdown boundaries         |
| Primary action | `#D9A24A` | Brass action with blackened-steel text |
| Brand brass    | `#E4A84B` | Registration and selected-state signal |
| Information    | `#7EA5E8` | Links, focus, and informational state  |
| Verified proof | `#42CEB5` | Verified/successful proof only         |
| Warning        | `#D7AB54` | Waiting and retry attention            |
| Danger         | `#FF8798` | Failure and destructive confirmation   |

Rules:

- The authenticated shell stays dark in both themes. The navigation field is obsidian `#050D11`,
  its brand plate is a deeper forged-black material, and the command bar steps up to graphite
  `#0B181D`; raised controls use `#14252B`. A restrained brass seam registers the command bar to
  the work canvas without making it another flat black strip.
- Primary actions are stable across roles: graphite in light mode and brass in dark mode. Brass is otherwise a restrained registration, selection, and brand signal. Oxide teal is reserved for verified proof.
- Destructive actions remain outlined and controlled before intent is confirmed; the confirmation action may use the solid danger treatment.
- Semantic amber, red, and green appear only when the state genuinely requires them.
- Role colors are small rails, dots, borders, or icons. They are not competing page themes or small body text on steel.
- Never communicate state by color alone; pair it with a label, icon, and where needed an explanation.
- Avoid rainbow headings, generic pearl gradients, glass cards, neon glows, and endless white rounded containers.

## Typography

All fonts are locally bundled and work offline.

- Display, product headings, UI, and body: **Plus Jakarta Sans Variable**. Its humanist-geometric
  forms keep dense operations legible while giving route headings and navigation a warmer,
  authored character. The operational interface does not use a condensed face; hierarchy comes
  from size, weight, rules, and alignment.
- IDs, timestamps, receipt numbers, hashes, and machine evidence only: **IBM Plex Mono**, locally bundled at 400/500/600.

Recommended scale:

| Role            | Desktop          | Mobile           |
| --------------- | ---------------- | ---------------- |
| Sign-in display | 58–64/58–64, 600 | 40–44/40–44, 600 |
| Page H1         | 40–44/44–48, 600 | 32–36/36–40, 600 |
| H2              | 24–28/30–34, 600 | 24/30, 600       |
| H3              | 18–20/24, 600    | 18/24, 600       |
| Large body      | 18/28            | 17/27            |
| Body            | 15–16/23–25      | 16/24            |
| Small body      | 13–14/19–21      | 14/21            |
| Evidence/labels | 12/18 minimum    | 12/18 minimum    |

Display tracking must not be tighter than `-0.025em`; the sign-in display uses approximately `-0.022em`. Use tabular figures for operational numbers. Product UI uses sentence case. Uppercase mono is limited to rare registration, receipt, and machine-evidence labels; it is not a substitute for hierarchy.

## Shape, elevation, and composition

- Controls: 6 px radius.
- Panels and repeated records: 8–12 px radius.
- Dialogs and focused sheets: 16 px radius.
- Use engraved rules, edge tabs, section bands, and spatial alignment before adding another card. Light work areas use archival-ivory surfaces and cool-steel insets, not floating white rectangles.
- Maintain only two elevation levels: resting work surface and focused tool/dialog.
- Inner-route mastheads are compact, normally 120–180 px. Sign-in and overview may use the larger Proof Spine composition.
- Real work and the primary action must appear in the first viewport.
- The main content grid may be wide, but readable text columns should remain bounded.

## Route patterns

- **Home:** compact role context, one action queue, three or four meaningful metrics, recent activity, and contextual guidance that can collapse.
- **Requests:** search/filter, dense results, and a three-stage composer: choose type → enter details → review and send. Preview approval, processing, and delivery before submission.
- **Request detail:** current state, next action, owner, and age first; semantic Proof Spine; attempt/delivery drill-down; one Technical evidence disclosure; sticky permission-aware actions.
- **Approvals:** actionable queue plus selected-request review. Keep Approve/Decline available without duplicating the same decision surface.
- **Request types:** compact live/draft/archived catalog.
- **Workflow editor:** topology, one focused inspector, live requester preview, validation/publish state, simulation path, and readable published summaries. JSON is Advanced only.
- **Processing:** one compact health strip. When failures exist, the incident/recovery queue comes first.
- **Delivery:** explicit Activity and Connections modes. Show receiver, event, attempts, response, and replay in a detail surface.
- **Activity log:** dense chronological activity with plain filters and expandable technical detail.
- **Notifications:** compact inbox with All, Unread, and Action needed filters plus direct related-request actions.
- **People:** searchable role/status list; role explanation lives in add/edit UI; protected demo roles remain visibly locked.
- **Forbidden/not found:** explain workspace context and provide Back and Switch workspace actions. Never offer Retry for authorization or a true missing route.

## Forms and decisions

- Every control has a persistent visible label, useful helper/error region, and correct input semantics.
- Search and select fields in the same toolbar share one label row, 46px control row, and helper
  row. Native dropdowns keep platform keyboard behavior while using a full control border and a
  dedicated chevron zone, so the affordance never depends on the browser's tiny default arrow.
- Errors use human language: “Enter at least 12 characters,” not raw schema-validator text.
- Focus the first invalid field after submission.
- Preserve an idempotency key across uncertain retries and rotate it only on success, cancellation, or meaningful input change.
- High-impact actions use a deliberate confirmation surface with clear consequence and safe focus behavior.
- Approvers see requester, amount, business fields, and history before the decision note and actions.

## Motion language

- Tactile controls: 180–220 ms.
- Drawer, selection, and state continuity: 220–300 ms.
- Use proof-stamp/seal resolution, list-to-detail continuity, transform-based queue movement, and once-only section reveals.
- Animate grouped sections, never every row in a large table.
- Hover/tap feedback must not change layout.
- No infinite particle wallpaper, bounce, mouse chase, scroll hijacking, or repeated generic opacity/translate entrances.
- Reduced motion removes choreography without hiding content or changing task order.

## Responsive and mobile

- Validate at 320, 360, 390, 768, 1024, 1440, and short landscape 844×390.
- Touch targets are at least 44×44 px. Mobile form text remains at least 16 px.
- Recompose dense tables as disclosure rows/cards; do not merely make desktop tables horizontally scrollable.
- Put the active task and primary action in the first viewport.
- Collapse metrics into a compact 2×2 strip where needed.
- Use sticky primary actions for request review, approval, and recovery flows.
- Avoid nested scrolling and keep the workspace identity, theme control, and navigation accessible at every supported width.
- The mobile sign-in page shows the form first and replaces the animated Proof Spine with a compact static seal.

## Accessibility and quality gates

- Text meets WCAG AA; required component boundaries meet 3:1 non-text contrast.
- Keep semantic state descriptions available to assistive technology even when visually condensed.
- Use sequential headings, logical DOM/visual/tab order, visible focus, and named icon-only actions.
- Dialogs provide initial focus, Escape/close, focus containment, and focus return.
- Test keyboard-only use, reduced motion, 200% zoom, touch, light/dark themes, and long content.
- Verify no document overflow, unnamed controls, console/page errors, failed assets, or unexpected 4xx/5xx responses.
- Production-measure the optional spatial chunk and confirm initial route HTML does not reference it.

## Forbidden patterns

- Raw JSON as the default requester or approver experience.
- Metaphor-heavy task copy where plain language is clearer.
- A full cinematic hero on every route.
- Nested card walls, glass panels, gradient CTAs, rainbow typography, ambient particles, or decorative page-wide WebGL.
- Tiny all-caps mono copy below 12 px.
- Color-only state, inaccessible role-colored text, or disabled controls whose explanation exists only in a tooltip.
- Automatic effectful retries that bypass stable idempotency protections.
- Persisting access tokens, secrets, or request credentials in browser storage.
