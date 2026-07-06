# Handoff: Roster — Hospitality Workforce SaaS

## Overview
**Roster** (by "Zaleit IT", domain `roster.zaleit.com.au`) is a web app for small Australian hospitality venues (cafés, kebab shops, small kitchens) to run their whole week: build rosters, track clock‑ins (kiosk + phone), manage leave, certifications, stock checks and supplier orders — for a **flat monthly fee, no per‑shift charge, no aggregator cut**. The demo tenant is **"Troy's Kebabs"**, owner "Troy".

The product has three surfaces:
1. **Marketing + auth** (public): landing page, passwordless sign‑in, business onboarding.
2. **Owner web app** (desktop): the operator's back‑office — dashboard, rosters, timesheets, reports, staff, leave, certs, stock, items, suppliers, settings.
3. **Staff‑facing** (kiosk + phone): in‑venue tablet **kiosk clock‑in**, plus PIN‑gated phone pages for staff (clock‑in, notices `/me`, public roster `/r`, availability `/a`).

---

## About the design files
The files in `design/` are a **design reference built as a single HTML/React prototype** (`Roster.dc.html`). They demonstrate intended **look, layout, copy and behaviour** — they are **not production code to copy verbatim**. `Roster.dc.html` uses a bespoke in‑house template runtime (`support.js`) that is specific to our design tooling; **do not port that runtime**.

Your task is to **recreate these designs in the target codebase's own environment** (e.g. React/Next, Vue, Rails+Hotwire, SwiftUI, etc.), using its established component library, routing, state management and styling conventions. If no codebase exists yet, pick an appropriate modern stack (a React SPA or Next.js app with a component library maps cleanly to this design) and implement there.

The prototype is a **single‑file screen switcher** (a left "prototype rail" jumps between screens). In a real build each screen is its own **route**; the rail is only a demo affordance and should **not** be reproduced. The real global chrome is the **dark top navigation bar** + dropdowns (see `screenshots/18-chrome/`).

## Fidelity
**High‑fidelity.** Colours, typography, spacing, radii, shadows, copy and interaction states are all final and intentional. Recreate pixel‑faithfully using the codebase's own primitives. Exact hex values, fonts and measurements are given below and are visible in the per‑block screenshots.

---

## Reading the screenshots
`screenshots/<NN-screen>/` holds component‑level captures — **individual block tiles, not just whole pages**, as requested. Naming convention per owner screen:

- **`01-shot.png`** — the screen as it renders **in‑app** (dark top nav + real page, narrow viewport). Use for context/chrome.
- **`02-shot.png`** — the same screen **content rendered at full design width (~1300px)**, clean. Use this as the layout reference.
- **`03-shot.png`, `04-shot.png`, …** — each **isolated block/tile** on that screen, in top‑to‑bottom order (KPI tiles, cards, tables, list rows, form panels). These are the "each block" shots.

Special folders:
- `01-landing/` — `01/02-shot` top fold; `01–05-block` = isolated marketing blocks + scrolled sections (hero mockup, feature row, 3‑step, pricing).
- `17-kiosk/` — full **state flow**: `01-pick → 02-pin-empty → 03-pin-entered → 04-actions → 05-confirm → 06-gps-blocked`.
- `18-chrome/` — `01` dark top nav + rail; `02` notification bell dropdown open.

> Screenshots were taken at a constrained preview width, so full‑width multi‑column screens were re‑rendered at 1300px for the `02` shots. Treat the **numbers in this README** (not screenshot pixel measurement) as the source of truth for sizing.

---

## Design tokens

### Brand & colour
| Token | Hex | Use |
|---|---|---|
| **Primary green** | `#76b900` | Brand, primary buttons, active states, accents (NVIDIA‑like lime) |
| Primary green hover | `#6aa600` | Button hover |
| Green‑ink (text on tint) | `#3F6212` / `#4D7C0F` / `#5A7D17` | Green text on light‑green surfaces |
| Green tint surface | `#F4F8E9` | Active nav, badges, callouts |
| Green tint 2 | `#F0F6E2` / `#ECFDF3` | Pills, success badges |
| **Ink / near‑black** | `#111827` | Primary text, dark top nav bg, dark buttons |
| Dark nav border | `#1F2937` / `#374151` | Dividers on dark |
| Text secondary | `#374151` | Body |
| Text muted | `#6B7280` | Sub‑labels |
| Text faint | `#9CA3AF` | Meta, placeholders, icons |
| Border | `#E5E7EB` | Card borders, inputs |
| Border faint | `#F1F3F5` / `#F3F4F6` | Inner dividers |
| App background | `#F9FAFB` | Page bg |
| Surface | `#FFFFFF` | Cards |
| Surface faint | `#FAFBFC` / `#FCFCFB` | Table headers, footers |

### Semantic / status
| Meaning | Text | Background | Border |
|---|---|---|---|
| Success / Valid / Approved / Published | `#15803D` | `#ECFDF3` | `#BBF7D0` |
| Warning / Pending / Expiring | `#B45309` | `#FEF3E2` | `#FED7AA` |
| Danger / Expired / Denied / Needs order | `#B91C1C` | `#FEECEC` | `#FECACA` |
| Info / Still clocked in | `#1D4ED8` | `#EFF6FF` | `#BFDBFE` |
| Neutral / Draft | `#6B7280` | `#F3F4F6` | `#E5E7EB` |

### Shift‑type palette (roster grid colour coding)
| Shift | Stripe | Tint bg | Label text | Time text |
|---|---|---|---|---|
| Morning | `#76b900` | `#F4F8E9` | `#3F6212` | `#5A7D17` |
| Arvo/Afternoon | `#7C5CBF` | `#F2EEFB` | `#5B43A6` | `#6E57B8` |
| Close | `#1E293B` | `#EEF1F5` | `#1E293B` | `#566476` |
| Split | `#D97706` | `#FDF2E3` | `#B45309` | `#C26A0C` |

Availability dot: Available `#16A34A`, Partial `#D97706`, No response `#9CA3AF`.
Item/supplier category chips: Meat `#B91C1C/#FEECEC`, Produce `#5A7D17/#F0F6E2`, Packaging `#475569/#EEF1F5`, Beverages `#1D4ED8/#EFF6FF`, Bakery `#B45309/#FDF2E3`.

Staff avatar colours (initials on solid circle): Sarah `#C2683B`, Jake `#5B6B7B`, Marcus `#A67C00`, Aisha `#8E5A9E`, Tom `#2F7D6B`, Priya `#B5524E`, Liam `#6B7280`.

### Typography
Two Google fonts:
- **Archivo** (400–900) — display/headings, numbers, labels, badges, brand wordmark. Used at heavy weights (700–900). Headings use `letter-spacing:-.015em to -.025em`; uppercase labels use `letter-spacing:.05–.09em`.
- **Public Sans** (400–700) — body, buttons, form controls, secondary text.
- **Material Symbols Rounded** — all icons (referenced by ligature name, e.g. `grid_view`, `schedule`, `beach_access`, `verified`, `local_shipping`, `notifications`). Optical settings used: `opsz 20–48, wght 100–700, FILL 0–1`.

Type scale (px): page h1 **25**, dashboard/onboarding h1 **27**, marketing hero **54/900**, section h2 **30–34**, card title **15–16/700**, KPI number **30/800**, body **13–15**, meta **11–12.5**, uppercase eyebrow labels **10–11/700**.

### Spacing, radius, shadow
- Radius: inputs/buttons `9–11px`, cards `14px` (standard), large cards/panels `16–18px`, pills `20–30px`, avatars `50%`, chips `5–8px`.
- Card shadow (resting): `0 1px 2px rgba(17,24,39,.04)` or `0 1px 3px rgba(17,24,39,.05)`.
- Elevated (dropdowns/modals): `0 18px 40px rgba(17,24,39,.20)` (nav menu), `0 22px 52px rgba(17,24,39,.24)` (bell), `0 6px 20px rgba(17,24,39,.10)` (CSV preview).
- Hover lift on shift cells: `translateY(-1px)` + `0 5px 14px rgba(17,24,39,.11)`.
- Content max width: **1340px**, page padding `26px 30px 80px`.
- Toggle switch: 44×26 track, 20px knob, on‑track `#76b900`, off‑track `#E5E7EB`.

### Motion (keyframes in source)
- `rosterFade` .14–.15s ease — dropdowns/menus.
- `rosterToast` .26s ease — toast slide‑up from bottom‑right.
- `rosterPulse` 2.2s infinite — red notification badge ping.
- `rosterShimmer` — skeleton loading (defined, available).
- Nav/hover transitions `.12–.16s`.

---

## Global chrome (owner app)
See `screenshots/18-chrome/`.

**Top nav bar** (`height 60px`, bg `#111827`): brand mark (green `grid_view` glyph in `#76b900` rounded square + "ROSTER" wordmark in Archivo 800 green) · tenant name "Troy's Kebabs" (muted, left border divider) · primary nav groups **Rosters / Team / Orders / Settings** each a hover‑and‑click dropdown (`expand_more` chevron; active group underlined with `inset 0 -2px 0 #76b900` and green text) · right side: **notification bell** (badge with unread count + red pulse) and **Sign out** button (outlined on dark).

**Notification bell dropdown** (`376px`, white, radius 14): header "Notifications" + "Mark all read"; scrollable list of rows (30px rounded‑square tinted icon, bold title, body, timestamp; unread rows have a coloured left border `3px`, read rows `opacity .62`); footer "See all notifications →". Clicking a row marks it read and navigates to its target screen.

Nav group → screen map: Rosters → {Roster periods, Shift types, Shifts(builder), Timesheets, Reports}; Team → {Staff, Leave, Certifications}; Orders → {Stock levels, Items, Suppliers}; Settings → {Settings}.

**Do not build the left "prototype rail"** — that's a demo device. Real navigation is the top bar + routes.

---

## Screens / Views

There are **18 designed screens** + **4 staff phone screens that are specified but not yet built** (see "Unbuilt" at the end). Each owner content screen sits inside the top‑nav chrome, centered at max‑width 1340px.

### 1. Marketing landing (`/`, chrome: bare) — `screenshots/01-landing/`
Dark hero (`#111827`) → white body. Sections top‑to‑bottom:
- **Top bar**: brand, Features / Pricing links, "Sign in" (ghost) + "Start free" (green) buttons.
- **Hero**: pill "● Built for Australian hospitality"; h1 "Your whole week, **sorted in minutes.**" (Archivo 900/54, second line green); sub‑paragraph; CTAs "Start free →" (green, glow shadow `0 8px 24px rgba(118,185,0,.28)`) + "See the roster builder" (dark outline); reassurance line "No credit card · Flat monthly fee · Cancel anytime".
- **Product mockup**: a browser‑chrome card (traffic lights, lock + URL, "Troy's Kebabs · Week of 23 Jun") containing a **read‑only mini roster grid** (same data as the builder), radius‑top only, sitting flush to the hero bottom.
- **Feature row** (5 columns): Schedule, Attendance, Leave, Inventory, Analytics — each a 46px green‑tint icon tile + title + one‑liner.
- **"How it works — Three steps. No manual."**: 3 outlined cards (01 Add your team / 02 Build your roster / 03 Publish & go).
- **Pricing band** (green‑tint section): dark card with headline "Flat monthly fee. No per‑shift charges. No aggregator cut." + price card **$49/mo** flat, unlimited staff, "Start free", "14‑day trial · no card".
- **Footer** (dark): brand blurb + Product / Support link columns + legal row.

### 2. Sign in (`/signin`, bare) — `screenshots/02-signin/`
Centered 412px card on a radial green‑tint wash. **Two states**:
- *Not sent*: "Sign in to Roster" + passwordless email form (pre‑filled `owner@zaleit.com.au`), "Send sign‑in link" (green), footer "Signed in as … not you? Sign out and use a different email".
- *Sent* (`signinSent`): success — `mark_email_read` circle, "Check your email", "Open the demo link →" (dark, → dashboard), "Use a different email" resets.
Passwordless magic‑link only; no password field.

### 3. Onboarding setup (`/onboarding`, bare) — `screenshots/03-onboarding/`
Centered 460px card. Top strip: signed‑in identity + "Sign out". Body: eyebrow "Step 1 of 1 — almost there", h1 "Let's set up your business.", single **Business name** field (pre‑filled "Troy's Kebabs"), "Create my business →". On submit → dashboard in **new‑owner** state + toast "Troy's Kebabs is set up — let's get rostering".

### 4. Dashboard / home (`/`, owner) — `screenshots/04-dashboard/`
Has a **prototype toggle** (New owner / Established) — in production this is **two real states driven by data**, not a visible toggle.
- **New‑owner state**: welcome h1 "Welcome to Roster, Troy.", a **"Get set up" checklist card** — progress header (120×8 bar, 25%), checklist rows (done row struck‑through with green DONE pill; pending rows "Start →" → shift types / builder / settings), and a footer "Optional — set up later" (Add a supplier, Add items).
- **Established state**: "Good morning, Troy." + "Week of 23 Jun". **4 KPI tiles** (`03–06`): Hours this week **142h** (+18h pending), Est. labour cost **~$4,820** ("estimate only — not payroll"), On leave today **2** (Marcus · Liam), Certs expiring **3** (blue, clickable → certs). Quick‑action buttons: Build roster (green), View timesheets, Approve leave (badge 1). **Recent activity card** (`07`): first 3 notifications, "View all →".

KPI tile spec: white, border `#E5E7EB`, radius 14, padding 18, shadow `0 1px 2px rgba(17,24,39,.04)`; label 12.5 muted 600 + faint icon top‑right; big number Archivo 800/30 (coloured per metric); sub‑line 12.5.

### 5. Roster periods (`/rosters`, owner) — `screenshots/05-rosterlist/`
Header + "New roster period" (green). One **list card** (`03`): each period row = 42px green‑tint calendar tile, week label + sub ("Next week/This week/Last week"), status badge (COLLECTING AVAILABILITY / DRAFT / PUBLISHED), staff count, response meta, and a **Build** (green) or **View** (ghost) button. Footer note: "Older periods are archived automatically after 12 weeks." Data: 4 periods (30 Jun–6 Jul collecting; 23–29 Jun draft; 16–22 & 9–15 Jun published).

### 6. Roster builder ★ (`/rosters/:week`, owner) — `screenshots/06-builder/`
The flagship screen. Header: title + DRAFT/PUBLISHED badge, week stepper "Week of 23 Jun 2026" with ‹ ›, "N staff · N shifts rostered", and actions "Draft from last week" (ghost, sparkle icon) + **Publish roster** (green; when published becomes a green "Published" confirmation + a copy‑link button).
- **The grid card** (`03`): sticky‑header, sticky‑first‑column scrollable table. Columns = "Staff member" + 7 days (each day header shows name+date and a green count pill of staff on shift). Rows = staff (avatar, name, role) × 7 day cells. Plus a footer **"Open shifts"** row for unassigned shifts.
- **Cell variants**: *Shift* (tinted card, coloured left stripe `3px`, availability dot top‑right, shift name + time; hover lifts), *On leave* (grey diagonal‑hatch), *Open* (dashed border, "Open · {type}", "0 claimed · tap to assign"; hover turns green), *Empty* (faint "+", hover green tint).
- **Legend** below the grid: the 4 shift colours, 3 availability dots, and the on‑leave hatch.
- Publish → toast "Roster published — 6 staff notified".

### 7. Shift types (`/rosters/shift-types`, owner) — `screenshots/07-shifttypes/`
Header + "Add shift type" (green). **3‑column card grid**: each shift‑type card (`03–06`) has a top colour bar (8px), a colour swatch + name, an "Edit" link, a time pill (`schedule` + range on a tinted chip), and a usage count ("Used in N shifts"). Plus a **dashed "New shift type"** card (`07`) with a colour‑swatch picker preview. Data: Morning 6:00am–2:00pm, Afternoon 2:00pm–10:00pm, Close 6:00pm–close, Split (varies).

### 8. Timesheets (`/timesheets`, owner) — `screenshots/08-timesheets/`
Header + "Export approved hours (CSV)" with disclaimer "approved hours × entered rates. Estimate only — not a payroll calculation." Filter row: date range chip, status chip, and a live tally "6 approved · 4 pending · 1 needs fix". **Table card** (`03`), columns: Staff / Day / Clock in / Clock out / Hours / Shift / Status. Notable cells: a `wrong_location` warning icon when GPS was outside radius; **Approve** inline action on pending rows; status badges APPROVED / PENDING / STILL CLOCKED IN / NO CLOCK‑OUT. Hours are tabular‑nums. Data: 12 entries.

### 9. Reports & analytics (`/reports`, owner) — `screenshots/09-reports/`
Title "Labour & hours" + estimate disclaimer + range segmented control (This week / Last 4 weeks / Custom range). **4 KPI tiles**: Total approved hours **142h**, Estimated labour cost **$4,820** (with warning), Pending (not costed) **+18h**, Staff without rates **2** (warning). Two‑column row: **"Approved hours by week"** bar‑list card (4 weeks, horizontal bars, current week green `#76b900`, others `#C5DC8C`, each with hours + est cost) and a **staff cost table** (Staff / Rate / Hours / Est. cost; rows with no rate show an amber "No rate set" chip). All costs labelled estimates.

### 10. Staff (`/staff`, owner) — `screenshots/10-staff/`
Header + an **"Add someone" inline bar** (name + email + "Add to team"). Two‑column layout: **left list** (340px) of staff cards (avatar, name, role · email, small status chips ON LEAVE / ⚠ CERT; selected card has green border+tint) and a **right detail panel**:
- Header: 54px avatar, name, role · email, "Generate PIN".
- Two columns: **Pay rate** (big number `/hour`, rate type, "rate label, informational only") and **Staff notices** ("Copy notices link" — PIN‑gated `/me` link).
- **Certifications** list: each row = status icon + name + detail + VALID/EXPIRING SOON/EXPIRED badge.
- **Documents** (Google Drive‑backed): "Drive connected · owner@gmail.com" indicator; document rows (`description` icon, name, Open, delete) OR empty state; "Upload document" + "Disconnect Drive". If Drive not connected, a dashed **"Connect Google Drive"** promo. Copy stresses **documents live in the owner's own Drive, not Roster's servers**.
Data: 6 staff profiles with rates, cert lists and docs (see `design/Roster.dc.html` `STAFF` + `STAFF_PROFILES`).

### 11. Leave requests (`/leave`, owner) — `screenshots/11-leave/`
Header + an **info banner** (`02`, blue): "Leave is recorded for scheduling purposes. Balances and accruals are managed by your payroll provider." **List card** (`03`): each request row = avatar, name + leave type, dates + day count, reason (quoted), and either **Deny / Approve** actions (pending) or a status badge APPROVED/DENIED (decided). Approving/denying updates state + notifies. Data: 5 requests (2 pending).

### 12. Certifications (`/certs`, owner) — `screenshots/12-certs/`
Header + auto‑reminder pill "Reminder emails sent automatically". Filter toggle "Show expiring & expired only" (green when active). **Table card** (`03`): Staff / Certification / Expiry / Status (icon + badge) / Days left. Statuses VALID / EXPIRING SOON / EXPIRED / NONE RECORDED. Data: 10 cert rows across staff (RSA, Food Safety, First Aid).

### 13. Stock levels (`/stock`, owner) — `screenshots/13-stock/`
Header + red pill "N need ordering". **Table card** (`03`): Item / Supplier / Checked by (mini avatar) / Checked at / Status. Needs‑order rows have a faint red row bg + an "Order reminder sent" sub‑note. Statuses NEEDS ORDER / OK. Data: 8 stock‑check results.

### 14. Items / SKUs (`/items`, owner) — `screenshots/14-items/`
Header + "Import from CSV" + "Add item". Optional **CSV import preview card** (green‑accented, appears on Import): shows parsed rows (Item / SKU / Category) with add‑circles, "…and 20 more", Cancel / "Import 24 items". Main **table card** (`03`): Item / SKU (mono) / Category chip / Supplier / Reorder / Unit. Data: 11 items.

### 15. Suppliers (`/suppliers`, owner) — `screenshots/15-suppliers/`
Header + "Add supplier". **2‑column card grid**: each supplier card (`03–06`) = 42px green‑tint truck tile, name + category chip, edit icon, contact email + phone rows, and a **delivery‑day chip row** (Mon–Sun; active days green). Plus a **dashed "Add a supplier"** form card (`07`) with name/contact inputs, day picker, dark "Add supplier" button. Data: 4 suppliers with delivery days.

### 16. Settings (`/settings`, owner) — `screenshots/16-settings/`
Two columns of cards:
- **Account** (`03`): avatar, email, "Signed in", Business "Troy's Kebabs", "Display only — contact support to change".
- **Clock‑in** (`04`): **Kiosk link** (readonly + Copy + Generate new), **Personal phone link** (Copy + Regenerate), **Require GPS** toggle + radius select (100/200/500 m), **Require photo on clock‑in** toggle, **Photo retention** select (7/30/90 days).
- **Notifications** (`05`): 6 toggle rows — Leave requests submitted, Shift released/claimed, Stock marked needs‑ordering, Certifications expiring, Availability replies, Team notices.
- **Google Drive** (`06`): connected state (as `owner@gmail.com`, folder "Roster Documents", Disconnect) or connect promo.

### 17. Kiosk clock‑in (`/kiosk/:tenant`, standalone dark full‑screen) — `screenshots/17-kiosk/`
In‑venue tablet flow, dark theme (`#0E1320` radial). Header: brand + "Kiosk", tenant name + date/time "Mon 23 Jun · 11:42 am". **State machine**:
1. **Pick** (`01`): "Tap your name to start" → 3‑col grid of staff tiles (avatar + first name).
2. **PIN** (`02`/`03`): "Enter your PIN" + selected name, 4 dot indicators (fill green as typed), numeric keypad (0–9, Cancel, backspace). Auto‑advances at 4 digits.
3. **Actions** (`04`): "Hi {name} 👋" → big green **Clock In** + 2×2 grid Clock Out / Request Leave / Stock Check / Shift Swap, "← Not you? Start over".
4. **Confirm** (`05`): green success panel "Clocked in", name · time, "Done", auto‑returns in 5s countdown.
5. **GPS blocked** (`06`): red panel "Clock‑in blocked — you appear to be outside the clock‑in area — 320m away, limit 200m. Please see your manager." (Marcus triggers this in the demo.)
Keypad hit targets are 70px tall.

### 18. Notification centre
`notifications` reuses the dashboard with the bell dropdown open — treat as the bell component, not a separate page.

---

## Interactions & behaviour
- **Navigation**: top‑nav groups open on hover **and** click; clicking an item routes. Active screen highlights its parent group.
- **Toasts**: most write actions fire a bottom‑right toast (dark pill, green check, slide‑up, auto‑dismiss ~3.4s). Examples: Publish → "Roster published — 6 staff notified"; Export → "Exported 9 approved entries to CSV"; Copy link actions → the copied URL; Create business → setup confirmation. Full list in `renderVals()` of `design/Roster.dc.html`.
- **Notifications**: unread count drives the red pulsing badge; clicking a notification marks read + routes to target; "Mark all read" clears all.
- **Roster builder**: Publish flips draft→published (badge + toast + share affordance appears). Shift cells hover‑lift; open/empty cells are click targets to assign.
- **Timesheets/Leave**: inline Approve / Deny mutate row status.
- **Certifications**: filter toggle narrows to expiring+expired.
- **Items**: "Import from CSV" reveals a preview card; Confirm imports + toast; Cancel dismisses.
- **Settings toggles**: GPS / photo / per‑event notifications / Drive are optimistic switches.
- **Kiosk**: full state machine described above; PIN auto‑submits at 4 digits; confirm auto‑resets on a countdown; specific staff (Marcus) demonstrates the GPS‑block path.
- **Auth**: passwordless — email → "link sent" state → demo "open link" → dashboard.

## State management
Prototype keeps everything in a single component state; in production split by route/feature. Key state the UI reads:
- `screen` / route; `openNav` (which nav dropdown is open); `bellOpen`; `toast`.
- `dashView` — new‑owner vs established dashboard (derive from real onboarding progress).
- `rosterPublished` (draft vs published).
- `signinSent`; onboarding submit.
- `selectedStaff`; `staffDrive` (Drive connected per staff); Drive at account level `setDrive`.
- `certFilter`; `csvPreview`.
- Settings: `setGps`, `setPhoto`, `notifToggles{leave,shift,stock,certs,avail,notices}`.
- `notifs[]` with `unread` flags.
- Kiosk: `{step, name, pin, count}`. Phone/`/me`/availability: `phonePin/phoneView`, `mePin/meUnlocked/meRead{}`, `availDays{}/availSubmitted` (logic exists, UI TODO — below).

Data fetching: replace the in‑file constant arrays (`STAFF`, `STAFF_PROFILES`, `ROSTER_PERIODS`, `SHIFT_TYPES`, `TIMESHEETS`, `TREND`, `REPORT_STAFF`, `LEAVE`, `CERTS_ALL`, `STOCK`, `ITEMS`, `SUPPLIERS`, `NOTIF_EVENTS`) with API/DB reads. These arrays double as **realistic seed/fixture data** and exact field shapes — reuse them.

## Product/compliance guardrails (keep in the copy)
The design is deliberate about **not being a payroll product**: labour figures are always "estimate — hours × rates only, not payroll"; leave is "recorded for scheduling, balances managed by your payroll provider"; pay rate is "informational only"; documents live in the **owner's own Google Drive**. Preserve these disclaimers.

## Assets
- **Fonts**: Google Fonts *Archivo*, *Public Sans*, and *Material Symbols Rounded* (load the same three; icons are ligature‑based). No custom icon set.
- **Imagery**: none — no photos or illustrations are used. The only "graphics" are the CSS brand mark (a Material `grid_view` glyph in a rounded square), avatars are coloured initials, and the marketing "product screenshot" is a live HTML mini‑grid. If you later add real photography, none is required to match the design.
- **Logo**: wordmark "ROSTER" in Archivo 800 + green `grid_view` glyph tile. No raster logo file.

## Files in this bundle
- `design/Roster.dc.html` — the full prototype (all screens, data, interactions). **Read this for exact markup, copy and every toast string.** It uses an in‑house runtime; treat as reference, not a dependency.
- `design/support.js` — the prototype runtime (do **not** port).
- `screenshots/` — per‑screen, per‑block captures (see "Reading the screenshots").

---

## Unbuilt (specified, no UI yet) — staff phone screens
The prototype's left rail lists four **phone** screens and the logic/seed data for them **already exists** in `renderVals()` (`phone`, `ppad`, `meList`, `me`, `mepad`, `publicDays`, `availRows`, `availOpts`), but the **markup was never written** — the phone device shell renders empty (`<!--PHONE_SCREENS_END-->`). Build these as mobile (390px device / responsive) pages using the existing data shapes:

1. **Phone clock‑in** (`/clock/:tenant`) — personal‑phone equivalent of the kiosk: PIN pad → clock in/out. State: `phoneView` (`idle/in/out/locked`), `phonePin` (4‑digit), `ppad` keypad.
2. **Staff notices** (`/me`, PIN‑gated) — a staff member's own feed: unlock via `mePin` → `meList` notices (leave approved, rostered, shift reminder) each with detail + read state (`meRead`), "Mark all read".
3. **Public roster** (`/r/:tenant`) — read‑only published week: `publicDays` = per‑day list of who's on (name, role, time, shift colour dot).
4. **Availability** (`/a`, staff) — staff submit next‑week availability: `availRows` per day with Available / Partial / Off options (`availOpts`), submit/reset (`availSubmitted`).

Match the kiosk's dark, large‑touch‑target visual language for the clock‑in; the `/me`, `/r`, `/a` pages should follow the same brand tokens on a light background. Confirm intended layouts with the product owner before building, since only data — not visual design — is defined for these four.
