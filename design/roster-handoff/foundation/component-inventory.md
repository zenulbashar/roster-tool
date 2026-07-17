# Roster — Component Inventory & State Matrices

The full kit used across all five surfaces. Each entry lists the component's
purpose, key style values, and its **state matrix** (every visual state a
developer must build). Isolated visual references for the starred (★)
components live in `foundation/components/` and in each surface's `blocks/`
folder. Build these as real, reusable components in the app's component library.

> Values reference `design-tokens.md`. All type is Archivo (display/labels/numbers)
> or Public Sans (body/controls); all icons are Material Symbols Rounded ligatures.

---

## Global / chrome

### Top navigation bar (owner) ★
Dark bar, height **60px**, bg `#111827`, `box-shadow:0 1px 0 #1F2937`.
Left → right: brand mark (Leaf `grid_view` in a `#111827`/rounded-square + "ROSTER" wordmark, Archivo 800, **Leaf `#5FA875`**) · tenant name "Troy's Kebabs" (`#9CA3AF`, left-border divider) · nav groups **Rosters / Team / Orders / Settings** · right: notification bell + "Sign out" (outlined on dark, `1px #374151`).
- **Nav group states:** rest `#C7CDD6`; hover opens dropdown; **active** parent `color:#5FA875` + `box-shadow:inset 0 -2px 0 #5FA875`. Each group has a chevron `expand_more`.
- **Dropdown:** opens on hover **and** click; white, radius 12, `min-width 196px`, shadow-menu, `rosterFade`; rows = faint icon + label, hover `#F3F4F6`.
- Group→screen map: Rosters → {Roster periods, Roster builder, Availability requests, Shift types, Timesheets, Reports, Templates}; Team → {Staff, People, Leave, Certifications, Forms}; Orders → {Stock, Items, Suppliers}; Settings → {Settings, Locations, Xero, Notifications}.
- **Do NOT build the prototype's left rail** — it's a demo screen-switcher. Real nav = this top bar + routes.

### Notification bell + dropdown ★
Bell icon; unread count badge with **red `#DC2626` pulsing ping** (`rosterPulse`).
- **Dropdown** (`376px`, white, radius 14, shadow-bell): header "Notifications" + "Mark all read" (`#13301F`); scrollable rows; footer "See all notifications →".
- **Row states:** unread = coloured `3px` left border + tinted 30px rounded-square icon; read = `opacity .62`. Click → marks read + routes to `target` screen.
- Seed notifs: Leave request (warn), Shift swap (success), Stock alert (danger).

### Toast ★
Bottom-right, dark pill `#111827`, radius 12, shadow-toast, `rosterToast` slide-up, auto-dismiss **~3.4s**. Leaf `#5FA875` `check_circle` + message. Fired by most write actions (full string list in `04-*`/`05-*` specs and the prototype `renderVals()`).

---

## Core kit

### Button ★
| Variant | Fill | Text | Border | Hover |
|---|---|---|---|---|
| Primary (Forest) | `#13301F` | `#fff` | none | `#1D4A2E` |
| Primary (Leaf, dark surfaces) | `#5FA875` | `#111827` | none | `#4E9666` |
| Secondary / ghost | `#fff` | `#374151` | `1px #E5E7EB` | bg `#F9FAFB` / `#F3F4F6` |
| Dark-on-dark (Sign out) | none | `#D1D5DB` | `1px #374151` | — |
| Danger (impersonation) | `#B91C1C` | `#fff` | none | `#991B1B` |
| Text/link | none | `#13301F` | none | `#1D4A2E` |
Radius 9–11px; label Archivo 700 (primary) / Public Sans 600 (secondary), 13–15px; padding ~11×16; optional leading/trailing Material icon.
**States:** default · hover (above) · focus (`--focus-forest`, or `--focus-blue` on kiosk/phone) · active · disabled (reduce opacity / neutral fill). Loading state uses `rosterShimmer` or an inline spinner.

### Card / Panel ★
White, `1px #E5E7EB`, radius **14** (panels 16–18), shadow-card, usually `overflow:hidden`. Common internal parts: header row (`14–22px` pad, bottom `1px #F1F3F5`), an uppercase Archivo eyebrow (11px/700/.07em, `#9CA3AF`), body, and a `#FAFBFC` footer.

### PageHeader ★
Row: left = h1 (Archivo 800/25, `-.015em`) + muted sub-paragraph (13.5px `#6B7280`); right = primary action button. Wraps on narrow. Some headers add an inline status badge or an icon tile beside the title (Xero, Availability requests).

### Badge / status pill ★
Uppercase Archivo ~9.5–11px/700, letter-spacing .04–.05em, padding 4×9, radius 6, `1px solid`. Full colour set + labels in `design-tokens.md §4`. **Matrix:** PUBLISHED · DRAFT · COLLECTING AVAILABILITY · APPROVED · PENDING · STILL CLOCKED IN · NO CLOCK-OUT · DENIED · NEEDS ORDER · OK · VALID · EXPIRING SOON · EXPIRED · NONE RECORDED · LIVE · ACTIVE · HOME · ADMIN.

### Banner / callout ★
Inline info strip: tinted bg + `1px` border + leading icon + copy. **Variants:** Info blue (`#EFF6FF`/`#BFDBFE`/`#1D4ED8` — Leave, People, Xero-push honesty); Forest (`#ECF3EE`/`#CFE3D6`/`#13301F` — pay-rules honesty); Warning (`#FDF2E3`/`#FED7AA`/`#B45309` — Xero security check); Danger (`#FEF2F2`/`#FECACA`/`#B91C1C` — Xero payroll-access error, impersonation write).

### KpiTile ★
See `design-tokens.md §8`. Number colour varies per metric (Forest for hours; ink for cost/counts; blue for a clickable metric like "Certs expiring"; admin indigo `#312E81`). Optional sub-line, warning accent, or a trailing warning icon.

### Toggle switch ★
44×26 track, 20px knob, transition .16s. On `#13301F` (site GPS) or `#5FA875` (on dark); off `#E5E7EB`. **States:** on · off · focus.

### Avatar ★
Initials, white text, Archivo 700, solid circle; per-person colour (`design-tokens.md §5`). Sizes seen: 26/30/31/32/34/38/44/52/54/56/66px.

### Segmented control / tabs ★
Pill group in a `#F3F4F6` track, `1px #E5E7EB`, radius 11, 3–4px pad. Selected = white chip + shadow; rest = `#6B7280`. Used for report range, Xero sub-tabs (`#13301F` selected fill variant), dashboard state toggle (prototype-only).

### Table / list card ★
Card wrapper; header row `#FAFBFC` + `1px #E5E7EB` bottom, Archivo 10.5px/700/.06em uppercase `#9CA3AF`; data rows `1px #F3F4F6` separators. Wide tables set an inner `min-width` and scroll horizontally. Numeric columns `font-variant-numeric:tabular-nums`. Row-level accents: faint-red bg for needs-order stock rows, inline Approve/Deny actions, `wrong_location` GPS-warning icon.

### Form controls ★
Inputs: `1px #D1D5DB`, radius 11, pad 13×14, Public Sans 14.5; focus `border #13301F` + `--focus-forest`. Inline "search" field variant (icon + borderless input in a bordered pill). Choice chips: bordered pill, hover `border/color #13301F`.

### Dashed "add" card / empty-state ★
`1.5px dashed #D1D5DB`, radius 15–16; centered icon tile (`#ECF3EE`) + title + helper; hover `border #13301F` + bg `#ECF3EE`. Used for: New shift type, Add supplier, Save-as-template, Create-a-form, Connect Drive/Xero, empty pay-rules.

---

## New / surface-specific components

### Impersonation banner ★ (admin → acting-as)
Persistent, fixed, full-width, **height 52px**, bg `#B91C1C` + 45° repeating-stripe overlay (6% black, 14px), shadow `0 3px 14px rgba(185,28,28,.4)`. Filled `warning` icon + copy **"Acting as {venue} — changes save to their LIVE account."** (`LIVE account` bold+underlined) + "Exit to admin" button (white bg, `#B91C1C` text, `logout` icon). Accompanied by a fixed full-viewport inset frame `4px #DC2626`, and it pushes page content down by 52px.
- **Related modals:** *Entry confirm* ("View as venue — live account", red header, full read/write warning, Cancel / "Enter live account"); *Write confirm* ("Writing to {venue}'s live account." danger box, Cancel / "Save to live account") — fired before any write while impersonating.

### PIN pad ★ (kiosk + phone)
Numeric keypad, `repeat(3,1fr)` grid. Kiosk keys **70px** tall (`#1C2433`/`1px #2A3344`, Archivo 700/25px, radius 16); phone keys 60–62px. Bottom row: Cancel/Re-enter (text) · 0 · backspace (`backspace` icon). 4 dot indicators above fill Leaf `#5FA875` as typed; auto-submit at 4 digits. Light `/me` variant: white keys, hover `#ECF3EE`.
- **PIN flow states (kiosk):** pick → **pin** (dots + pad) → **wrong** ("That PIN didn't match", *N tries left*) → **locked** (60s countdown ring) → **actions** → **confirm**/**gps**.

### Geofence radius control ★ (locations)
Card with a hatched map preview (`#EDF4EF` + 45° `#E3EEE7` stripes), a centered `location_on` pin + mono "radius {N}m" chip, and a `[ map preview ]` mono tag. A translucent Forest circle scales with radius (`circlePx = 70 + radius/500*150`). Below: radius option buttons `[100, 150, 200, 500]m` (selected = Forest fill; focus `--focus-blue`) + a "Require GPS at this site" toggle.

### Roster-builder cell ★ (builder grid)
Grid = `216px + repeat(7, minmax(132px,1fr))`, sticky header row + sticky first column. Day headers show name+date + a Forest count pill (`#E3EEE7`). **Cell variants:**
| Variant | Look |
|---|---|
| Shift | tinted card, `3px` coloured left stripe, availability dot top-right, shift name + time; hover `--shift-lift` |
| On leave | grey diagonal-hatch, "ON LEAVE / Approved" |
| Open | dashed border, "Open · {type}", "0 claimed · tap to assign"; hover → green |
| Empty | faint `+`, hover `#EDF4EF` tint |
Footer "Open shifts" row for unassigned shifts. Legend below: 4 shift colours + 3 availability dots + on-leave hatch.

### Pay-rules row + split preview ★ (Xero → Pay rules)
Rule row: card, `drag_indicator` grab handle + priority chip (`#ECF3EE`/Forest) + condition (icon + text) + `arrow_forward` + mapped pay-item chip (`#E3EEE7`/`#CFE3D6`) + up/down/delete icon buttons. "First match wins — drag to reorder priority."
**Split preview:** a horizontal bar split into segments — "Ordinary · 2–6pm" (`#ECF3EE`/Forest text) and "Matched rule · 6–10pm" (`#13301F` fill/white). Caption: "First matching rule classifies each block. Everything else stays ordinary. Final pay is decided in Xero."
**Empty state:** "No pay rules — and that's on purpose" + "Add your first rule".

### Xero mapping row ★ (Xero → Employee mapping)
Grid `1.4fr .3fr 1.4fr .8fr 1fr`: staff (avatar + name) · `arrow_forward` · Xero employee name **or** a "Match employee" button (unmatched) · ordinary rate (tabular-nums) · status badge (MATCHED / UNMATCHED). Header count "N of 6 matched" + a red "N unmatched — excluded from push" pill. Footnote: "Ordinary rate is read from each Xero employee. Roster never sets or overrides it."

### Location card ★ (locations list)
Selectable card: `storefront` tile + name + optional HOME badge + address; footer row `group` staff-count + `my_location` radius. Selected = Forest border+tint.

### Shift-type card ★ (shift types)
Top `8px` colour bar; colour swatch + name; "Edit"; time pill (`schedule` + range on tinted chip); "Used in N shifts". Plus dashed "New shift type" card with a colour-swatch picker preview.

### Supplier card ★ (suppliers)
`local_shipping` green-tint tile + name + category chip + edit icon; contact email/phone rows; delivery-day chip row Mon–Sun (active days Forest). Plus dashed "Add a supplier" form card.

### Staff detail panel ★ (staff)
54px avatar + name + role·email + "Generate PIN"; two columns Pay rate ("informational only") / Staff notices ("Copy notices link" → `/me`); Certifications list; Documents (Google-Drive-backed, or Connect-Drive promo). Copy stresses **documents live in the owner's own Drive, not Roster's servers.**

### Availability matrix ★ (availability requests, owner)
Grid `180px + repeat(7,1fr)`: staff rows × day cells; each cell a coloured dot (Available/Partial/Off) or a small "no response yet" dot. Header progress bar "N of 6 replied" + COLLECTING badge + Send-reminder / Start-building actions. Legend below.

### Phone hub cards ★ (/me)
Upcoming-shift rows (tint tile + shift dot), a 2×2 quick-action grid (Availability / Request leave / Shift swaps¹ / Forms²  — badge counts), "Forms to complete" rows (due chips), and notice cards (unread blue dot, mono detail chip, read on tap).

### Public roster day group ★ (/r)
Sticky day header (name + date + "N on") over per-person rows (shift-colour dot + name + role + time). Empty day → italic "No one rostered".
