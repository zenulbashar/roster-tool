# Prompt for Claude Design — "Forest" refresh of the Roster prototype

> Paste this into Claude Design (the project already open at `Roster.dc.html`).
> It works **on the prototype** and commits the result to GitHub; Claude Code
> then ports the look into the real Next.js app across all screen sizes.
> Full depth lives in `docs/design-brief-forest.md` in the connected repo.

---

**Extend — don't replace — the existing Roster design in `Roster.dc.html`.**
Keep every screen, all copy, layout, type (Archivo + Public Sans + Material
Symbols Rounded), spacing, radii and shadows. Make exactly one brand change, then
make every screen responsive.

## The one change: swap the brand green to Forest `#13301F`
The current accent is lime `#76b900`. Replace it with Forest `#13301F`. Because
Forest is **very dark** (unlike the light lime), two rules ride with it:

1. **Text on the green flips to white.** Every primary button, "done" pill and
   filled accent that today uses dark ink (`#111827`) on green now uses **white**.
2. **A second, lighter tone carries the accent on dark surfaces.** The dark header
   and the kiosk are near-black (`#111827` / `#0E1320`); Forest is invisible there.
   Use **Leaf `#5FA875`** for the wordmark, active-nav accent and kiosk highlights
   (keep it ≥4.5:1 on `#111827`).

Token map:
- Primary/brand fill `#13301F`; on-fill text **white**; hover **`#1D4A2E`** (a
  touch *lighter* — darkening turns black).
- Accent on dark surfaces → Leaf **`#5FA875`**.
- Pale green tint surface `#F4F8E9` → sage **`#ECF3EE`**; green text on it → `#13301F`.
- Morning / "Green" shift swatch: lime → forest-emerald bar **`#2E7D4E`** on sage
  (keep Arvo purple / Close slate / Split amber so the grid still colour-codes).
- Reports weekly bars: current week `#13301F`, other weeks sage `#B7CFBE`.
- Focus ring glow `rgba(118,185,0,.16)` → `rgba(19,48,31,.20)`; CTA glow →
  `rgba(19,48,31,.30)`.
- **Leave untouched:** blue `#1d4ed8` (links/focus/info) and all semantic status
  colours (success/warning/danger/info) — they're state, not brand.

## Cover every screen
Marketing landing · sign-in (+ check-email) · onboarding · dashboard (new-owner &
established) · roster periods · **roster builder** (staff×day grid, cells, open
row, legend) · shift types · timesheets · reports · staff (two-pane) · leave ·
certifications · stock · items (+ CSV import) · suppliers · settings · owner nav +
notification-bell dropdown · kiosk clock-in (full state flow) · personal phone
clock-in · staff notices `/me` · public roster `/r` · availability `/a`.

## Make every screen responsive — all four sizes
Design and show each screen at **mobile 390px · tablet 768px · laptop 1280px ·
desktop 1440px** (content capped at 1340px). Rules:
- No horizontal page scroll ever. Wide tables/grids scroll inside their own
  container with a sticky first column where one exists.
- Owner top-nav collapses to a hamburger panel on mobile; multi-column card grids
  collapse to 1–2 columns; the Staff/People two-pane stacks (list over detail).
- Tap targets ≥44px; kiosk keypad keys ≥70px.

## Keep the motion
Preserve the existing keyframes and recolour the accent ones to Forest/Leaf:
`rosterFade` (dropdowns), `rosterToast` (bottom-right confirm — check glyph in
Leaf), `rosterPulse` (unread bell ping — **stays red**, it's an alert). Keep
shift-cell hover-lift and `.12–.16s` colour transitions. Wrap all non-essential
motion in `prefers-reduced-motion`.

## Deliverables to commit to GitHub
1. The updated `Roster.dc.html` (or equivalent prototype files) with Forest applied
   to every screen at all four breakpoints.
2. **Per-screen and per-block screenshots** — one capture per screen at
   mobile + desktop, plus an isolated shot of each block/tile (KPI tiles, cards,
   table, list rows, form panels), mirroring the existing
   `design/handoff/screenshots/<NN-screen>/` convention. Put them under
   `design/forest/screenshots/`.
3. A short note of the exact Forest/Leaf hex values used.

## Guardrails
Presentation only — don't change copy meaning, field names or flows. Keep the
disclaimers verbatim (labour cost is an *estimate, not payroll*; leave is
*record-only*; pay rate is *informational only*; documents live in the *owner's
own Google Drive*). Semantic HTML, keyboard-navigable, visible focus, WCAG AA —
verify white-on-Forest, Forest-on-sage and Leaf-on-`#111827` all pass.
