# QueueForge design system

**Product:** A local workflow orchestration and operations console for platform engineers.

**Design thesis:** QueueForge should feel like a well-kept control desk: dense enough for incident work, calm enough for long sessions, and explicit about state. Its signature is a narrow vertical **queue rail** that connects lifecycle events without turning the interface into decoration.

**Dials:** variance 5/10, motion 2/10, density 8/10.

## Visual language

- Light surfaces resemble technical paper and equipment labels, not glossy cards.
- Dark surfaces use blue-black layers rather than pure black or inverted colors.
- Structure comes from 1 px rules, alignment, type weight, and restrained surface changes.
- Corners are modest (4–8 px). Pills are reserved for statuses, not general containers.
- Shadows are rare. Use them for floating dialogs and menus only.
- No glassmorphism, gradient blobs, marketing hero, card-within-card layouts, or decorative charts.

## Color tokens

| Role           | Light     | Dark      | Use                                         |
| -------------- | --------- | --------- | ------------------------------------------- |
| Canvas         | `#F4F6F7` | `#10171D` | App background                              |
| Surface        | `#FFFFFF` | `#162129` | Primary work surface                        |
| Surface raised | `#F9FAFB` | `#1C2A34` | Toolbar/dialog contrast                     |
| Foreground     | `#15202A` | `#EDF3F5` | Main text                                   |
| Muted text     | `#52616D` | `#A9BAC4` | Secondary text (must remain AA)             |
| Rule           | `#C9D2D8` | `#344650` | Dividers and input borders                  |
| Primary navy   | `#183B56` | `#8EC5E8` | Selected navigation and focus context       |
| Action blue    | `#1D63D2` | `#68A5FF` | Primary actions and links                   |
| Forge orange   | `#C65D20` | `#FF9B63` | Queue rail, attention, one signature accent |
| Success        | `#177245` | `#52CC8A` | Successful state with icon/text             |
| Warning        | `#8A5A00` | `#F2BE52` | Retry/pending state with icon/text          |
| Danger         | `#B4232C` | `#FF7D85` | Failure/destructive state with icon/text    |
| Focus          | `#0B6FE8` | `#8BC1FF` | 3 px visible keyboard ring                  |

Never communicate status by color alone. Every status includes readable text and, where space permits, a consistent Lucide icon.

## Typography

Use fonts available on the target Windows machine so the archive remains offline and deterministic.

- Display/navigation: `Bahnschrift`, `Arial Narrow`, sans-serif.
- Body/forms: `Segoe UI`, `Arial`, sans-serif.
- IDs, times, metrics: `Cascadia Code`, `Consolas`, monospace with tabular figures.
- Scale: 12 utility, 14 dense body, 16 default/mobile form body, 20 section title, 28 page title.
- Body line height 1.5; operational rows may use 1.35 only when labels remain readable.

## Layout and spacing

- Base spacing unit: 4 px; common gaps are 8, 12, 16, 24, and 32 px.
- Desktop: persistent 232 px rail, compact top status bar, fluid main workspace.
- Tablet: collapsible navigation drawer; never create a second primary navigation system.
- Mobile: top app bar plus one navigation drawer, single-column content, tables become scroll-contained or key/value rows.
- Main content max width is 1600 px, but data tables may use the available viewport.
- Touch targets are at least 44×44 px with at least 8 px separation.
- No hidden content behind fixed navigation and no page-level horizontal scrolling at 375 px.

## Signature queue rail

The queue rail is a 2 px vertical line with 10–12 px state nodes beside a timeline, approval, or request summary. The current state uses forge orange; complete states use semantic success; failures use danger plus a failure icon. Labels and timestamps remain the primary information. Motion is an optional 180 ms opacity/translate transition and is disabled under `prefers-reduced-motion`.

## Components

- Buttons: one primary action per view, 44 px minimum height, stable width during loading, no hover transforms that shift layout.
- Inputs: visible label and helper/error region, 44 px minimum height, validate on blur, focus the first invalid field after submit.
- Tables: sticky header only when it does not create nested-scroll traps; `aria-sort`; stable ID/time columns use monospace; filters and sort are allowlisted.
- Status badge: compact label + icon; semantic foreground/background pairs tested in both themes.
- Panels: use section borders and headers. Do not wrap every block in a rounded card.
- Dialogs: real dialog semantics, initial focus, Escape/close path, focus return, explicit confirmation for destructive/replay actions.
- Toasts: `aria-live=polite`, do not steal focus, include a recovery action when applicable.
- Charts: trends use lines/bars; queue target comparisons use compact bullet/progress views. Always show exact values and an accessible table or text summary.
- Empty/loading/error/forbidden/offline states are first-class variants for each major surface.

## Motion

- 150–220 ms for hover, press, disclosure, and status changes.
- Animate transform/opacity only; never block input or trigger layout shift.
- No scroll-reveal framework, bouncing controls, ambient pulsing, or decorative parallax.
- Respect reduced motion globally.

## Accessibility and performance gates

- WCAG AA text contrast (4.5:1 normal, 3:1 large); UI/data marks at least 3:1.
- Skip link, sequential headings, logical tab order, route-change focus, visible focus ring.
- Icon-only controls have accessible names; native controls are preferred.
- Charts have visible values, a text insight, and table alternative; tooltips are not hover-only.
- Heavy charts load dynamically and reserve their dimensions; core navigation and status need no chart bundle.
- Keep access tokens in memory only. No authentication material in localStorage or persisted query caches.
- Test at 375, 768, 1024, and 1440 px and with 200% text zoom.

## Forbidden patterns

- Emojis as application icons.
- Gradient CTA buttons, glass panels, oversized rounded cards, and generic bento layouts.
- Placeholder-only labels, invisible focus, color-only state, hover-only actions.
- Optimistic permission claims or hidden server errors.
- Automatic retry of effectful commands without a stable idempotency key.
- Charts without their values or an accessible alternative.
