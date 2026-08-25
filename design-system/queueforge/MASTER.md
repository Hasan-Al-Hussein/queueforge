# QueueForge design system

**Product:** A local, private workflow workspace for requesters, approvers, operators, and administrators.

**Design thesis:** QueueForge should make the next human action obvious before showing system detail. It feels calm, trustworthy, and approachable for long sessions while preserving an Advanced path for engineers. Its signature remains the lifecycle rail, supported by numbered guided steps and a subtle forge-grid canvas.

**Dials:** variance 5/10, motion 5/10, density 4/10.

## Experience principles

1. Lead with the human task: “Start a request,” “Review a decision,” or “Fix an item.”
2. Use progressive disclosure: normal controls first, technical IDs/JSON/queue semantics under Advanced details.
3. Generate request forms from workflow schemas. No ordinary requester or approver should need to understand JSON.
4. Use plain-language labels while preserving exact technical terms where they materially help operators.
5. Default to light mode. Preserve an explicit user theme choice locally; never infer dark mode on first use.
6. Give every screen a clear next step, helpful empty state, visible loading feedback, and recovery path.

## Visual language

- Light mode uses a soft blue-gray canvas, crisp white work surfaces, deep navy structure, and generous space.
- Dark mode uses distinct navy-charcoal layers with high-contrast text instead of near-black surfaces.
- The left navigation is the strongest color block; the main workspace stays quiet and readable.
- A subtle 28 px dot grid gives the canvas identity without visual noise.
- Corners are 8–16 px. Pills remain reserved for statuses and short route labels.
- Soft shadows distinguish working surfaces; dialogs receive the strongest elevation.
- Do not use glassmorphism, gradient buttons, decorative chart clutter, or motion without functional feedback.

## Color tokens

| Role           | Light     | Dark      | Use                                   |
| -------------- | --------- | --------- | ------------------------------------- |
| Canvas         | `#F5F7FB` | `#0D1623` | App background                        |
| Surface        | `#FFFFFF` | `#142235` | Primary work surface                  |
| Surface raised | `#F8FAFD` | `#1B2B40` | Forms, rows, and secondary surfaces   |
| Foreground     | `#172033` | `#F2F6FB` | Main text                             |
| Muted text     | `#5F6F85` | `#B0BED0` | Secondary text (AA minimum)           |
| Rule           | `#DCE3EC` | `#30445D` | Dividers and input borders            |
| Primary navy   | `#173F61` | `#9BD4FF` | Navigation and key context            |
| Action blue    | `#2563EB` | `#78A9FF` | Primary actions and links             |
| Forge orange   | `#E86F2B` | `#FF9B62` | One signature attention accent        |
| Success        | `#137A55` | `#61D49D` | Successful states with text/icon      |
| Warning        | `#995700` | `#FFD071` | Waiting/retry states with text/icon   |
| Danger         | `#C33245` | `#FF8B98` | Failure/destructive state             |
| Focus          | `#2563EB` | `#9BC2FF` | 3 px visible keyboard focus indicator |

Never communicate status by color alone.

## Typography

Use fonts already available on Windows so the product remains offline and deterministic.

- UI and headings: `Segoe UI Variable`, then `Segoe UI`, Arial, sans-serif.
- IDs and exact machine values only: `Cascadia Code`, Consolas, monospace.
- Scale: 12 helper/eyebrow, 15 default body, 16 comfortable descriptions, 18–20 section titles, 28–38 page titles.
- Body line height is 1.55. Avoid uppercase except short eyebrows and table headers.

## Layout and navigation

- Desktop: 252 px grouped navigation (Everyday work, Set up, Monitor, Organization) and a 72 px workspace bar.
- Main content max width: 1520 px with 18–44 px responsive gutters.
- Tablet/mobile: one modal navigation drawer with focus containment, Escape close, and focus return.
- Prefer one strong recommendation, four compact metrics, then supporting details.
- Touch targets are at least 44×44 px; mobile form body text remains at least 16 px.
- Verification workspaces are grouped separately in the workspace selector instead of mixed with demo workspaces.

## Forms and builders

- Requesters choose a named active workflow. The workflow key is never an everyday input.
- Render supported JSON Schema properties as labeled text, long text, number, yes/no, choice, email, URL, or date controls.
- Validate beside the exact field and focus the first invalid control.
- Admins build request forms visually. Keep Advanced JSON available without making it the default.
- Processing behavior uses labeled numeric controls; raw policy and delivery JSON live under Advanced disclosures.
- Approvers see a human-readable field summary before the decision note and actions.
- Stable technical identifiers are generated automatically where possible.

## Motion

- 150–220 ms ease-out for hover, press, disclosure, and dialog feedback.
- Buttons lift 1 px on hover and compress slightly on press without changing layout.
- At most one page-entry transition per view. Loading shimmer is allowed only while data is loading.
- Respect `prefers-reduced-motion` globally. No bounce, parallax, scroll hijacking, or ambient animation.

## Components and accessibility

- Buttons: one primary action per task area, stable loading state, clear active/disabled feedback.
- Inputs: persistent label, helper/error region, appropriate HTML input type and autocomplete where relevant.
- Panels: 14 px radius, 1 px rule, soft elevation, 18–20 px internal padding.
- Tables: server-backed pagination/search/sort where required; keep exact status and accessible names.
- Dialogs: native semantics, initial focus, Escape/close path, focus return, and visible async state.
- Charts: visible exact values and textual/table alternative; dynamically load heavy chart code.
- Use sequential headings, logical tab order, visible focus, and named icon-only actions.
- Test light/dark at 390, 768, 1024, and 1440 px, reduced motion, keyboard only, and 200% zoom.

## Forbidden patterns

- Raw JSON as the default requester or approver experience.
- Technical copy where plain language carries the same meaning.
- Forced onboarding tours, hidden navigation, or unexplained acronyms.
- Gradient CTA buttons, glass panels, oversized marketing cards, or color-only state.
- Automatic effectful retries without the existing stable idempotency protections.
- Persisting access tokens, secrets, or request credentials in browser storage.
