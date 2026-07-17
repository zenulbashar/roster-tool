# Prompt for Claude Design — round 2: identity + components + what's left

> Round 1 (Forest colour swap + responsive layer) is done in the `Roster.dc.html`
> project. This round refines the **brand identity**, elevates the **component
> system**, and closes the gaps. Same guardrails as before (see
> `docs/design-brief-forest.md` / `docs/claude-design-prompt.md` in the repo):
> extend — don't replace — presentation only, keep all copy + disclaimers,
> WCAG AA, respect `prefers-reduced-motion`.

---

## A. Identity — the ROSTER mark

The green wordmark on the dark bar reads muddy. Simplify and systematise it.

**Wordmark colour (the fix):**
- On **dark** surfaces (owner header, kiosk, landing hero, footer): wordmark is
  **white `#FFFFFF`**; the glyph tile stays **Leaf `#5FA875`** with a dark
  (`#13301F`) `grid_view` glyph inside. One pop of brand, wordmark crisp.
- On **light** surfaces (onboarding, sign-in, any light header): wordmark is
  **Forest `#13301F`**; glyph tile is **Forest** with a **white** glyph.
- Never put Forest text on the dark bar (invisible) or Leaf text as the wordmark
  (the muddy look we're fixing).

**Mark system (define these once, apply everywhere):**
- **Lockup:** glyph tile + wordmark, 10px gap, tile ~26–30px, wordmark Archivo 800,
  tracking `0.05–0.06em`.
- **Clear space:** keep at least the tile's height of padding around the lockup.
- **Mark-only variant:** the glyph tile alone (for the favicon, kiosk corner, tight
  mobile headers). Provide it.
- **Favicon / app icon:** the `grid_view` glyph on a Forest `#13301F` rounded tile
  (dark ground reads at 16px). Add it as an SVG/`<link rel="icon">` reference.
- Keep "Zaleit IT" as company meta only (footer) — not part of the mark.

## B. Component system — elevate, keep it operational

This is a hospitality back-office scanned and operated, not read — polish must serve
clarity, not decoration. Refine each shared primitive so the whole app reads as one
Forest system. Keep radii/shadows/type from the existing tokens; tighten
consistency and state feedback.

- **Buttons** — primary Forest/white with the `.12s` hover to `#1D4A2E`; a real
  pressed state; consistent height/padding across primary/secondary/dark/ghost/
  danger; visible focus ring (`rgba(19,48,31,.20)`), never removed.
- **Cards / SectionCard** — one resting shadow (`0 1px 2px rgba(17,24,39,.04)`),
  one border (`#E5E7EB`), one radius (14 / 16 for big); an optional Forest hairline
  or eyebrow to group sections. No competing shadows.
- **Badges / pills** — keep the semantic palette; make the Forest "active/ok" tone
  (`#13301F` on sage) consistent everywhere a green state appears (active filter,
  DONE pill, published, valid).
- **KPI tiles** — clearer hierarchy: 12.5px label, Archivo 800/30 number, 12.5px
  sub; the metric's own colour on the number; hover affordance only when the tile
  links. Consider a thin Forest accent rule or a tiny sparkline where a trend
  exists (hours-by-week) — subtle, optional.
- **Tables** (timesheets, certs, stock, items) — sticky header, row hover, zebra
  or hairline rows, tabular-nums for numeric columns, status in a badge **and** a
  left severity stripe so "needs attention" reads at a glance; each keeps its own
  `overflow-x:auto` scroll container.
- **Owner nav** — active group: green text + `inset 0 -2px 0` **Forest** underline
  on light / **Leaf** on the dark bar; dropdowns `rosterFade`; the mobile
  hamburger drawer from round 1.
- **Notification bell + dropdown** — unread red pulse stays; unread rows get a
  Forest `3px` left border; read rows `opacity .62`; 376px, radius 14, elevated
  shadow.
- **Toasts** — dark pill, **Leaf** check glyph, `rosterToast` slide-up, ~3.4s.
- **Forms** — Field label 12.5/600, input focus = Forest border + `rgba(19,48,31,
  .20)` ring; error state in danger with a fix-it message; the 44×26 Switch with
  Forest on-track.
- **Empty states** — muted icon + Archivo title + one-line guidance + a primary
  action; consistent across staff/forms/stock/etc.
- **Iconography** — Material Symbols Rounded only; use **filled** for active/selected
  and outline for idle, consistently.

## C. What's still missing

1. **The 4 staff phone screens** (empty `<!--PHONE_SCREENS_END-->` stubs in the
   prototype) — build them in Forest, responsive (390px), using the data already in
   the logic. Match the kiosk's **dark, large-touch** language for clock-in; light
   Forest for the rest:
   - **Phone clock-in** `/clock` — PIN pad → clock in/out (dark).
   - **Staff notices** `/me` — PIN unlock → per-type notice list (leave decided,
     rostered, shift reminder), read state, "Mark all read" (light).
   - **Public roster** `/r` — read-only published week, per-day who's-on with
     shift-colour dots (light).
   - **Availability** `/a` — per-day Available / Partial / Off toggles, submit/reset
     (light).
2. **True breakpoint screenshots** — if the preview can't capture real
   viewport-width shots, that's fine: leave the media rules verified and note it.
   Claude Code will capture the mobile/tablet/laptop/desktop matrix from the real
   app during the port.
3. **Getting the work into GitHub** — you have read-only GitHub access, so **don't
   try to push**. Instead: export/download the updated `Roster.dc.html` +
   `design/forest/tokens.md` (and any screenshots) so they can be handed to Claude
   Code, who will commit them and port the look into the real Next.js app.

## D. Deliverables

- Updated `Roster.dc.html`: white-on-dark / Forest-on-light wordmark rule applied
  everywhere the mark appears; the component refinements in §B; the 4 phone screens
  in §C.
- The mark-only variant + favicon reference.
- `design/forest/tokens.md` updated with the wordmark + any component token notes.
- A short changelog of what round 2 changed.

*Everything stays presentation-only and AA. Verify white-on-dark, Forest-on-sage,
Leaf-on-`#111827`, and the new favicon at 16px all read clearly.*
