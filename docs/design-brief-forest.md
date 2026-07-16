# Design brief — "Forest" refresh for Roster

**Audience:** Claude Code (design + implementation).
**Repo:** `zenulbashar/roster-tool` (public — clone/read it directly).
**Type:** Presentation-only reskin that **extends** the existing "Roster" design
system. **The one substantive change is the brand green: replace the current
Zaleit lime `#76b900` with Forest `#13301F` everywhere it is used as the brand /
accent / primary-action colour.** Everything else — layout, copy, data flow,
tenancy, validation — stays as-is unless this brief says otherwise.

> This is a **brief**, not a diff. It tells you exactly what to build, which
> files to touch, how to keep it accessible, what to screenshot, and what to
> commit. Read the two source-of-truth files first, then work screen by screen.

---

## 0. How to use this brief

1. **Read the design system that already exists** (do not reinvent it):
   - `design/handoff/README.md` — the original design tokens, per-screen specs,
     interaction notes, and the per-block screenshot map.
   - `docs/design-implementation-plan.md` — how those designs were mapped onto
     this Next.js codebase, and the current screen status table.
   - `src/app/globals.css` — the live design tokens (`@theme`).
   - `src/components/ui.tsx` — the shared component kit (Button, Card, KpiTile,
     Badge, Banner, Switch, Toast, Avatar, PageHeader, Field, …). **Reuse these.**
   - `src/lib/avatar.ts`, `src/lib/shift-colors.ts` — deterministic colour helpers.
2. **Apply the Forest colour migration** in §2 (token first, then hardcoded hex).
3. **Work through the screen inventory** in §4, extending each screen for the four
   breakpoints in §5 and preserving the animations in §6.
4. **Capture the per-tile / per-block screenshots** in §7 and **commit them** with
   the code.
5. **Respect the guardrails** in §8 and the definition of done in §9.

### Hard boundaries (do not cross)
- **Presentation only.** Never change server actions, data fetching, form field
  `name`s, `href`s, route paths, zod validation, tenancy scoping, or background
  jobs. If a visual you want needs new data, render a clearly-labelled placeholder
  and note it — do **not** add columns/migrations.
- **Keep the product disclaimers verbatim** (labour cost is an *estimate, not
  payroll*; leave is *record-only*; pay rate is *informational only*; documents
  live in the *owner's own Google Drive*).
- **Accessibility is non-negotiable:** semantic HTML, keyboard-navigable, visible
  focus, WCAG AA contrast. The Forest swap makes this *more* important — see §2.3.

---

## 1. What the product is (feature inventory)

**Roster** (by "Zaleit IT") is a mobile-first staff-scheduling app for small
Australian hospitality venues. It has **three surfaces**: public marketing/auth,
the owner back-office, and staff-facing phone/kiosk pages. Every feature below has
live UI in the repo and must be reskinned.

| Area | Feature | Primary route(s) |
|---|---|---|
| **Marketing / auth** | Landing, passwordless sign-in, business onboarding | `/`, `/sign-in`, `/sign-in/check-email`, `/onboarding` |
| **Dashboard** | KPI tiles, quick actions, recent activity, getting-started checklist | `/app` |
| **Rosters** | Roster periods, roster builder (drag-and-drop board), shift types, per-day/per-weekday time & staffing overrides | `/app/periods`, `/app/periods/[id]`, `/app/periods/[id]/build`, `/app/periods/[id]/request`, `/app/templates` |
| **Attendance** | Timesheets + approvals, clock-in photos, CSV export | `/app/timesheets` (+ `/photo/[id]`, `/export`) |
| **Reporting** | Hours & labour-cost report, weekly bars, per-staff cost | `/app/reports` |
| **Team** | Staff (two-pane), People pool, Locations, Leave, Certifications | `/app/staff`, `/app/people`, `/app/locations`, `/app/leave`, `/app/certifications` |
| **Shift swaps** | Release → claim → owner-approve, open shifts, cross-location cover | `/app/shifts` |
| **Inventory** | Stock levels, Items/SKUs + CSV import, Suppliers | `/app/stock`, `/app/items` (+ `/import`, `/sample`), `/app/suppliers` |
| **Forms** | Form builder, publish + public collection, responses, CSV export | `/app/forms`, `/app/forms/[id]`, `/app/forms/[id]/responses` |
| **Settings** | Account, clock-in (kiosk/GPS/photo), notification prefs, Drive | `/app/settings` |
| **Notifications** | Owner header bell + full list | bell in `/app` layout, `/app/notifications` |
| **Integrations** | Xero draft-timesheet push, pay-classification rules, Google Drive docs | `/app/xero`, `/app/xero/push`, `/app/xero/rules`, `/xero/connected` |
| **Staff phone** | Notices `/me`, public roster `/r`, availability `/a`, internal forms | `/me/[token]`, `/me`, `/me/forms/[id]`, `/r/[slug]`, `/a/[token]`, `/f/[slug]` |
| **Kiosk / clock** | Shared-tablet kiosk, personal-phone GPS clock-in | `/kiosk/[token]`, `/clock/[token]` |

Full product context lives in `CLAUDE.md` (milestones M1–M32). You do not need to
change any of that logic — you are reskinning what it already renders.

---

## 2. The brand change — Forest `#13301F`

### 2.1 The core swap
The current primary/accent green is **`#76b900`** (a light NVIDIA-like lime),
hover **`#6aa600`**, glow `rgba(118,185,0,…)`. Replace the brand green with
**Forest `#13301F`** (RGB 19·48·31 — a very dark, near-black forest green).

### 2.2 ⚠️ The critical consequence: text-on-green must invert
`#76b900` is **light**, so today buttons put **dark** ink (`#111827`) on it.
`#13301F` is **very dark** (≈15:1 vs white), so **text on Forest must become
white**. This is the single most important thing to get right — miss it and every
primary button becomes unreadable. Flip these:

- `--color-button-ink: #111827` → **`#FFFFFF`**
- `--color-accent-ink: #111827` → **`#FFFFFF`**
- Every hardcoded `text-[#111827]` that sits **on a green fill** → **white**
  (primary buttons in `page.tsx`, `onboarding`, `sign-in`, kiosk/clock forms —
  see the file list in §2.5).

### 2.3 Two greens, one family (the on-dark problem)
The owner header/nav and the kiosk are **dark** (`#111827` / `#0E1320`). Forest
`#13301F` on that near-black background is invisible (both are near-black). So the
Forest system needs **two tones**:

| Role | Token | Value | Text on it | Notes |
|---|---|---|---|---|
| **Deep Forest** (brand on *light* surfaces, primary buttons) | `--color-button` / `--color-accent` on content | `#13301F` | **white** | ~15:1 vs white ✓ |
| Forest hover | `--color-accent-dark` | `#1D4A2E` | white | *lighten* on hover (darkening → black) |
| **Leaf** (accent on *dark* surfaces: header wordmark, active-nav underline, kiosk highlights) | `--color-accent` (header context) | `#5FA875` | — | must stay **≥4.5:1 on `#111827`**; verify |
| Forest tint surface (was `#F4F8E9`) | `--color-accent-faint` | `#ECF3EE` | Forest text | pale sage |
| Forest text on tint (was `#3F6212`) | new `--color-forest-ink` | `#13301F` | — | ~13:1 on the pale sage ✓ |
| Focus ring glow (was `rgba(118,185,0,0.16)`) | inline | `rgba(19,48,31,0.20)` | — | keep the 3px ring pattern |
| Landing CTA glow (was `rgba(118,185,0,0.28)`) | inline | `rgba(19,48,31,0.30)` | — | subtle; consider the Leaf tone for glow on dark |

> **Decision for the owner (default = A):** the header/kiosk backgrounds stay
> near-black `#111827`/`#0E1320` and the **Leaf** tone carries the accent on them
> (Option **A**, recommended — least risk, cleanest contrast). **Option B**:
> make the chrome itself Forest (`--color-header` = `#13301F`) with a
> white/leaf wordmark for a bolder, more forest-forward brand. Build A; leave a
> one-line comment in `globals.css` noting B is a token flip away.

### 2.4 Token remap — edit `src/app/globals.css` `@theme` first
Changing tokens cascades to the ~25 files that already reference
`--color-button` / `--color-accent*`. Do this **before** touching hardcoded hex.

```
--color-button:        #13301F   /* was #76b900 — primary buttons */
--color-button-ink:    #FFFFFF   /* was #111827 — WHITE text on Forest */
--color-accent:        #5FA875   /* Leaf — wordmark/active accent ON THE DARK HEADER (verify ≥4.5:1 on #111827) */
--color-accent-dark:   #1D4A2E   /* was #6aa600 — Forest hover (lighten) */
--color-accent-faint:  #ECF3EE   /* was #F4F8E9 — pale sage tint surface */
--color-accent-ink:    #FFFFFF   /* was #111827 — text on a Forest fill */
--shift-morning-bar:   #2E7D4E   /* was #76b900 — see §2.6 */
--shift-morning-bg:    #ECF3EE   /* pale sage */
/* add: */
--color-forest-ink:    #13301F   /* Forest text used ON pale sage tints (replaces the old #3F6212 green-ink) */
```

Leave `--color-brand` (blue `#1d4ed8`) **untouched** — it is links/focus/info, not
the brand green, and must stay distinct.

### 2.5 Hardcoded hex — replace after the tokens
~59 literal `#76b900` / `#6aa600` / `rgba(118,185,0,…)` occurrences across 24
files are **not** token-driven and must be edited by hand. When the hex is a
**fill**, swap to `#13301F` (hover `#1D4A2E`) **and flip its text to white**; when
it is an **accent on a dark surface** (header/kiosk/landing hero), use the Leaf
`#5FA875`; when it is a **pale tint / green-ink pair**, use `#ECF3EE` / `#13301F`.

Files with hardcoded green to sweep (grep `76b900|6aa600|118, ?185, ?0`):
`src/app/page.tsx` (landing — most occurrences; hero is dark → Leaf, buttons →
Forest+white), `src/app/onboarding/page.tsx`, `src/app/sign-in/page.tsx`,
`src/app/sign-in/check-email/page.tsx`, `src/app/kiosk/page.tsx`,
`src/app/clock/page.tsx`, `src/app/xero/connected/page.tsx`,
`src/components/KioskForm.tsx`, `src/components/KioskClockForm.tsx`,
`src/components/PersonalClockForm.tsx`, `src/components/StaffShiftLists.tsx`,
`src/components/StaffHeader.tsx`, `src/components/NoticesPinForm.tsx`,
`src/components/AddStaffFields.tsx`, `src/components/ui.tsx` (focus ring),
`src/app/app/reports/page.tsx` (weekly bars — §2.6),
`src/app/app/settings/page.tsx`, `src/app/app/templates/page.tsx`,
`src/app/app/suppliers/page.tsx`, `src/app/app/timesheets/page.tsx`,
`src/app/app/locations/page.tsx`, `src/app/app/people/page.tsx`,
`src/lib/shift-colors.ts` (§2.6).

### 2.6 Shift-type & chart palettes
- **Shift colours** (`src/lib/shift-colors.ts` — `SCHEMES.morning` and the
  `SHIFT_PALETTE` "Green" entry) are a *categorical* set (Morning / Arvo / Close /
  Split) that must stay **distinguishable from each other**. Retire the lime
  `#76b900` for the Morning/"Green" swatch → a **forest/emerald mid-green** that
  still reads as "green" but harmonises with the brand: bar `#2E7D4E`, bg
  `#ECF3EE`, text `#13301F`. Keep Arvo (purple), Close (slate), Split (amber),
  Sky/Blue/Emerald/Rose options as-is. Update the mirrored `--shift-morning-*`
  tokens to match.
- **Reports weekly bars** (`src/app/app/reports/page.tsx`): current-week bar
  `#76b900` → **`#13301F`**; other-week bars `#C5DC8C` (pale lime) → a muted sage
  **`#B7CFBE`**. (Bars are large fills, so the dark Forest reads well here.)
- **Avatar palette** (`src/lib/avatar.ts`) is deliberately *not* green — leave it.
- **Semantic** success/warn/danger/info greens/ambers/reds/blues are **status
  colours, not brand** — leave them (success stays `#15803D`/`#ECFDF3`).

### 2.7 Verify contrast
After the swap, spot-check with any WCAG contrast checker:
white on `#13301F` (≥4.5:1 ✓), `#13301F` on `#ECF3EE` (≥4.5:1 ✓), Leaf `#5FA875`
on `#111827` (≥4.5:1 — **adjust the Leaf hex up if it fails**), and every primary
button label. Do not ship a green-on-green or dark-on-dark regression.

---

## 3. Design foundation to **extend** (not replace)

Keep all of this; the Forest swap rides on top of it.

- **Type:** Archivo (`--font-display`, headings/numbers/badges/buttons) + Public
  Sans (`--font-sans`, body/UI) + Material Symbols Rounded (icons), loaded via
  `<link>` in `src/app/layout.tsx`. Scale: page h1 25px, dashboard/onboarding h1
  27px, marketing hero 54/900, KPI number 30/800, body 13–15, eyebrow 10–11/700.
- **Layout:** owner content max-width **1340px**, page padding `26px 30px 80px`.
- **Radii:** inputs/buttons 9–11px, cards 14px, big cards 16–18px, pills 20–30px.
- **Shadows:** resting `0 1px 2px rgba(17,24,39,.04)`; dropdown `0 18px 40px
  rgba(17,24,39,.20)`; bell `0 22px 52px rgba(17,24,39,.24)`.
- **Components (`src/components/ui.tsx`):** `Button`/`ButtonLink` (primary,
  secondary, dark, ghost, danger), `IconButton`, `Icon`, `Card`, `SectionCard`,
  `Eyebrow`, `Field`, `TextInput`, `Switch` (44×26), `PageHeader`, `Avatar`,
  `KpiTile`, `Banner`, `Badge` (success/warning/danger/info/draft/ok), `Toast`,
  `EmptyState`. Build every screen from these — no new UI kit.
- **Global chrome:** dark top nav (`OwnerNav.tsx`) with groups Rosters / Team /
  Orders / Forms / Settings, the location switcher, and the notification bell.

---

## 4. Screen inventory — routes, files, blocks

Every screen below already exists and is reskinned in place. "Blocks/tiles" is the
list of component units to reskin **and screenshot individually** (§7). Reference
captures live in `design/handoff/screenshots/<NN-…>/` (`02-shot` = full-width
layout reference; `03+` = the isolated block tiles).

### Surface A — Marketing & auth (bare chrome, green wash)
| # | Screen | Route | Files | Blocks / tiles | Ref |
|---|---|---|---|---|---|
| 1 | Landing | `/` | `src/app/page.tsx` | top bar+brand, hero (dark→**Leaf** accents, **Forest+white** CTAs), product mini-roster mockup, 5-col feature row, 3-step cards, pricing band, footer | `01-landing/` |
| 2 | Sign in | `/sign-in`, `/sign-in/check-email` | `src/app/sign-in/page.tsx`, `.../check-email/page.tsx` | 412px card on radial **Forest-tint** wash, passwordless form, "link sent" state | `02-signin/` |
| 3 | Onboarding | `/onboarding` | `src/app/onboarding/page.tsx`, `src/components/AccountIdentity.tsx` | identity strip, "Step 1 of 1" eyebrow, business-name card, Forest CTA | `03-onboarding/` |

### Surface B — Owner back-office (dark top nav + 1340px content)
Shared chrome: `src/app/app/layout.tsx`, `src/components/OwnerNav.tsx`,
`src/components/LocationSwitcher.tsx`, `src/components/NotificationBell.tsx`.

| # | Screen | Route | Files | Blocks / tiles | Ref |
|---|---|---|---|---|---|
| 4 | Dashboard | `/app` | `src/app/app/page.tsx`, `src/components/GettingStartedCard.tsx` | 4 KPI tiles, quick-action buttons, recent-activity card, getting-started checklist (Forest DONE pills + progress bar) | `04-dashboard/` |
| 5 | Roster periods | `/app/periods` | `src/app/app/periods/page.tsx`, `.../[id]/page.tsx`, `.../[id]/request/page.tsx` | list card, period rows (calendar tile + status badge + Build/View) | `05-rosterlist/` |
| 6 | **Roster builder ★** | `/app/periods/[id]/build` | `src/app/app/periods/[id]/build/page.tsx`, `src/components/RosterBoard.tsx` | week stepper + Publish, staff×day grid (shift cells, on-leave hatch, open/empty cells), Open-shifts row, schedule editor, legend, tap editor | `06-builder/` |
| 7 | Shift types | `/app/templates` | `src/app/app/templates/page.tsx` | 3-col shift-type cards (colour bar, time pill, usage count), dashed "New type" card w/ palette picker | `07-shifttypes/` |
| 8 | Timesheets | `/app/timesheets` | `src/app/app/timesheets/page.tsx`, `.../export/route.ts`, `.../photo/[id]/route.ts` | export bar + disclaimer, filter/tally row, table (status badges, GPS-warning icon, inline Approve, edit form) | `08-timesheets/` |
| 9 | Reports | `/app/reports` | `src/app/app/reports/page.tsx` | 4 KPI tiles, weekly bars (§2.6), staff-cost table, estimate disclaimers | `09-reports/` |
| 10 | Staff | `/app/staff` | `src/app/app/staff/page.tsx`, `src/components/AddStaffFields.tsx` | add-someone bar, left list (selected = **Forest** border+tint), detail panel (pay rate, notices link, certs, Drive docs) | `10-staff/` |
| 11 | People (org pool) | `/app/people` | `src/app/app/people/page.tsx` | people rows, per-location membership chips, lend-for-a-range form | — (extend to match §3) |
| 12 | Locations | `/app/locations` | `src/app/app/locations/page.tsx` | location list/switch, add-location form | — |
| 13 | Leave | `/app/leave` | `src/app/app/leave/page.tsx` | blue info banner, request rows (Approve/Deny → badge), record-leave form | `11-leave/` |
| 14 | Certifications | `/app/certifications` | `src/app/app/certifications/page.tsx` | reminder pill, "expiring/expired only" filter (**Forest when active**), table w/ status badges | `12-certs/` |
| 15 | Shifts (swaps) | `/app/shifts` | `src/app/app/shifts/page.tsx` | pending claims (Approve/Deny + conflict flags), open offers, post-open-shift form | — |
| 16 | Stock levels | `/app/stock` | `src/app/app/stock/page.tsx` | needs-order pill, table (needs-order red row bg), manual-set control | `13-stock/` |
| 17 | Items | `/app/items` (+ `/import`, `/sample`) | `src/app/app/items/page.tsx`, `.../import/page.tsx`, `.../sample/route.ts` | table, CSV import preview card (**Forest-accented**), category placeholders | `14-items/` |
| 18 | Suppliers | `/app/suppliers` | `src/app/app/suppliers/page.tsx` | 2-col supplier cards (truck tile, delivery-day chips **active = Forest**), dashed add-form | `15-suppliers/` |
| 19 | Settings | `/app/settings` | `src/app/app/settings/page.tsx`, `src/components/AccountIdentity.tsx` | Account, Clock-in (kiosk/GPS/photo, `Switch`), Notifications (6 toggles), Google Drive cards | `16-settings/` |
| 20 | Notifications | `/app/notifications` + bell | `src/app/app/notifications/page.tsx`, `src/components/NotificationBell.tsx` | bell dropdown (376px, unread left-border + red pulse), full list, mark-all-read | `18-chrome/02` |
| 21 | Forms | `/app/forms`, `/app/forms/[id]`, `.../responses` | `.../forms/page.tsx`, `.../[id]/page.tsx`, `src/components/FormEditor.tsx`, `.../responses/page.tsx`, `.../responses/export/route.ts` | form list, field editor, sharing panel, response summaries + paginated list | — |
| 22 | Xero | `/app/xero`, `/app/xero/push`, `/app/xero/rules` | `.../xero/page.tsx`, `.../push/page.tsx`, `.../rules/page.tsx`, `.../rules/rule-form.tsx` | staff→employee mapping, per-employee push preview, ordered pay-rules list | — |

### Surface C — Staff phone & kiosk
| # | Screen | Route | Files | Theme / blocks | Ref |
|---|---|---|---|---|---|
| 23 | Kiosk clock-in | `/kiosk/[token]` | `src/app/kiosk/page.tsx`, `.../layout.tsx`, `src/components/KioskClockForm.tsx`, `KioskForm.tsx`, `StaffShiftLists.tsx`, `LeaveRequestForm.tsx`, `StockCheckForm.tsx`, `PinActionForm.tsx` | **dark** state machine: pick → PIN pad → actions → confirm → GPS-blocked (accents → **Leaf**, big Forest CTAs w/ white text) | `17-kiosk/` |
| 24 | Personal clock | `/clock/[token]` | `src/app/clock/page.tsx`, `.../layout.tsx`, `src/components/PersonalClockForm.tsx`, `UseMyLocationButton.tsx` | dark, large-touch, GPS-checked | (kiosk language) |
| 25 | Staff notices | `/me/[token]`, `/me` | `src/app/me/page.tsx`, `.../layout.tsx`, `src/components/NoticesPinForm.tsx`, `StaffHeader.tsx` | **light**, per-type icon chips, branded PIN gate | (staff-light) |
| 26 | Staff forms | `/me/forms/[id]` | `src/app/me/forms/[id]/page.tsx`, `src/components/StaffFormFill.tsx` | light, reuses public fill UI | — |
| 27 | Public roster | `/r/[slug]` | `src/app/r/[slug]/page.tsx`, `src/components/StaffHeader.tsx` | light, per-day cards, shift-colour dots | — |
| 28 | Availability | `/a/[token]` | `src/app/a/[token]/page.tsx`, `src/components/StaffHeader.tsx` | light, colour dots + can-work/can't toggles | — |
| 29 | Public form | `/f/[slug]` | `src/app/f/[slug]/page.tsx`, `src/components/PublicFormFill.tsx`, `TurnstileWidget.tsx` | light, single-column, honeypot+Turnstile | — |
| 30 | Xero connect landing | `/xero/connected`, `/xero/connect/[token]` | `src/app/xero/connected/page.tsx` | light confirmation | — |

Shared bits: `src/components/CopyButton.tsx`, `src/components/ClearFlashCookie.tsx`,
`src/components/PinActionForm.tsx`.

---

## 5. Responsive requirements (mobile · tablet · laptop · desktop)

The app is **mobile-first in principle** but the owner back-office is today mostly
a fixed 1340px layout with only a light `sm:` fallback (grep shows ~29 `sm:`, few
`md/lg/xl`). **Extend every screen to render cleanly at all four breakpoints** —
this is an explicit goal of this brief.

| Tier | Width | Primary surfaces | Requirements |
|---|---|---|---|
| **Mobile / phone** | ≤640px (design ref 390px) | staff phone, kiosk (portrait tablet ok), owner pages via hamburger | single column; `OwnerNav` collapses to the hamburger panel; tables become stacked cards or horizontally scroll inside `overflow-x:auto`; tap targets ≥44px; kiosk keypad ≥70px |
| **Tablet** | 641–1024px | kiosk (landscape), owner | 2-col grids collapse to 1–2; two-pane Staff/People become stacked (list over detail) or a master-detail with back; sticky roster grid scrolls horizontally |
| **Laptop** | 1025–1340px | owner | full nav; content fluid up to max-width; KPI rows 4-up wrap to 2-up gracefully |
| **Desktop** | ≥1340px | owner | content capped at **1340px**, centered, `26px 30px 80px` padding (unchanged) |

Rules:
- **Never** let the page body scroll horizontally. Wide content (roster grid,
  timesheets/certs/stock tables, Xero preview) scrolls inside its **own**
  `overflow-x:auto` container with a sticky first column where one exists.
- Use the existing Tailwind breakpoints (`sm 640 / md 768 / lg 1024 / xl 1280`).
  Add `md:`/`lg:` variants where only `sm:` exists today; don't introduce a custom
  breakpoint config.
- Roster builder: the staff×day matrix keeps its sticky header + sticky
  "Staff member" column; on mobile the drag board degrades to the
  keyboard/tap editor below it (already the accessible path).
- Verify each screen at 390 / 768 / 1280 / 1440px.

---

## 6. Animations (keep + extend, sparingly)

Three keyframes already live in `src/app/globals.css` and must be preserved and
**recoloured to Forest/Leaf where they carry the accent**:

- `rosterFade` (.14–.15s ease) — nav dropdowns, bell dropdown, menus.
- `rosterToast` (.26s ease) — bottom-right toast slide-up (the check glyph uses
  `--color-accent` → now Leaf/Forest).
- `rosterPulse` (2.2s infinite) — the **red** unread-bell ping (stays red — it is
  an alert, not brand).

Extend (optional, only if it stays subtle and respects motion prefs):
- Shift-cell hover lift `translateY(-1px)` + `0 5px 14px rgba(17,24,39,.11)`
  (already specified) — keep.
- Button/hover colour transitions `.12–.16s` — keep.
- A `rosterShimmer` skeleton is referenced in the handoff; add it only for genuine
  loading states.
- **Wrap all non-essential motion** in `@media (prefers-reduced-motion: reduce)`
  to disable it — required for accessibility. Do not add parallax, autoplay, or
  large-scale entrance animations; this is an operational tool.

---

## 7. Screenshot deliverables (commit these)

Produce **per-tile / per-block** captures — not just whole pages — mirroring the
existing `design/handoff/screenshots/` convention, so the Forest result is
reviewable block by block and lands in git.

**Where:** `design/forest/screenshots/<NN-screen>/` (new folder; leave the
original `design/handoff/screenshots/` intact as the "before" baseline).

**Per screen, capture:**
- `01-shot.png` — the screen in-app at a **narrow/mobile** width.
- `02-shot.png` — the same screen at **full 1340px** (layout reference).
- `03-shot.png`, `04-shot.png`, … — **each isolated block/tile** top-to-bottom
  (KPI tiles, cards, table, list rows, form panels, badges), one file per block.
- Kiosk: capture the full state flow (`01-pick → 02-pin → 03-actions →
  04-confirm → 05-gps-blocked`).
- Chrome: `18-chrome/` equivalent — dark nav + bell dropdown open.

**How (Chromium + Playwright is pre-installed):** run the app
(`npm run dev:setup` then `npm run dev`), sign in to the demo tenant, and script
Playwright to visit each route at 390 / 768 / 1340px and `elementHandle.screenshot()`
each block by its container selector. Note: Material Symbols load from Google
Fonts at runtime — capture where outbound font access exists so icons render as
glyphs, not ligature text.

**Commit** the PNGs alongside the code changes (they are the visual record of the
reskin). Add a short `design/forest/README.md` indexing the folders and noting the
Forest token values used.

---

## 8. Guardrails checklist

- ✅ Presentation only — no server actions, data reads, `name`s, `href`s, routes,
  zod, tenancy, or jobs changed.
- ✅ Text on Forest is **white**; Leaf carries the accent on dark surfaces; blue
  `--color-brand` stays for links/focus/info; semantic status colours unchanged.
- ✅ WCAG AA verified on every button/badge/banner after the swap.
- ✅ Disclaimers preserved verbatim (labour estimate, leave record-only, rate
  informational, docs in owner's Drive).
- ✅ Reuse `src/components/ui.tsx` primitives + `avatar.ts` / `shift-colors.ts`.
- ✅ Reduced-motion respected; no page-level horizontal scroll at any breakpoint.
- ✅ `npm run typecheck && npm run lint && npm test` stay green (CI).
- ✅ Placeholders (item Category/Reorder, supplier Category, staff role) stay
  clearly labelled — no new schema.

## 9. Definition of done

1. `src/app/globals.css` tokens remapped to Forest/Leaf (§2.4); one comment noting
   Option B.
2. All ~59 hardcoded green literals swept across the 24 files (§2.5), with
   on-green text flipped to white and dark-surface accents on Leaf.
3. Shift Morning/"Green" swatch + reports bars recoloured (§2.6).
4. Every screen in §4 renders correctly at 390 / 768 / 1280 / 1440px (§5).
5. Animations preserved, recoloured, and reduced-motion-guarded (§6).
6. Per-block screenshots captured under `design/forest/screenshots/` and committed
   (§7).
7. Typecheck / lint / tests green; `docs/design-implementation-plan.md` updated
   with a "Forest refresh" note.

---

*Generated as a design brief for the `zenulbashar/roster-tool` public repo.
Source of truth for the existing look: `design/handoff/README.md` +
`docs/design-implementation-plan.md`. Brand change: replace `#76b900` with Forest
`#13301F` (with the white-text inversion and the Leaf on-dark accent it requires).*
