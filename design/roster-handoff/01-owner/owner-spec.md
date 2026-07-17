# 01 · Owner web app — per-screen spec

**Surface:** operator back-office. **Primary width:** desktop ~1340 (content
capped at 1340, page padding `26px 30px 80px`). **Also build:** tablet ~768 and
mobile ~375. **Chrome:** dark top-nav bar (see `foundation/component-inventory.md`
→ *Top navigation bar*). Demo tenant "Troy's Kebabs", owner "Troy".

Screenshots: `screens/<screen>-desktop|tablet|mobile.png`; isolated blocks in `blocks/`.

**Responsive (applies to every owner screen):** at ≤1023 the top nav collapses to
the app's mobile nav (the prototype shows an off-canvas drawer + hamburger — build
your real equivalent, not the prototype rail); at ≤900 multi-column grids reflow
(5→3, 4→2, 3/2→1, side-splits stack); at ≤600 grids go 5→2 / 4→1. Wide tables scroll
inside their card; the builder keeps a sticky first column + header.

**Guardrails that MUST stay in copy** (product is deliberately *not* payroll):
labour figures are always "estimate — hours × rates, not payroll"; leave is "recorded
for scheduling, balances managed by your payroll provider"; pay rate is "informational
only"; documents live in the **owner's own Google Drive**.

---

## Auth & entry (bare chrome, centered on radial `#ECF3EE→#F9FAFB` wash)

### Sign in `/signin`
- **Purpose:** passwordless magic-link sign-in. 412px card.
- **States:** *not-sent* — "Sign in to Roster", email form (pre-filled `owner@zaleit.com.au`), "Send sign-in link" (Forest), footer "Signed in as … not you? Sign out and use a different email". *sent* (`signinSent`) — `mark_email_read` circle, "Check your email", "Open the demo link →" (dark → dashboard), "Use a different email" (resets). No password field.
- **Components:** Card, form input, Button (primary + text).

### Onboarding setup `/onboarding`
- **Purpose:** first-run business creation. 460px card. Top strip: signed-in identity + "Sign out".
- **Content:** eyebrow "Step 1 of 1 — almost there", h1 "Let's set up your business." (27/800), single **Business name** field (pre-filled "Troy's Kebabs"), "Create my business →".
- **On submit:** → dashboard in **new-owner** state + toast **"Troy's Kebabs is set up — let's get rostering"**.

### Xero connected `/` (OAuth return) — 420px centered, success
- **Purpose:** confirmation after returning from Xero OAuth. Success check, "Xero connected", continue → Xero integration screen (`xeroReturnApp`).

---

## Home

### Dashboard `/` — screens/dashboard-*
- **Purpose:** operator home. **Two real states** (prototype exposes a New/Established toggle; in production derive from onboarding progress — do **not** ship the toggle).
- **New-owner state:** welcome h1 "Welcome to Roster, Troy."; a **"Get set up" checklist card** — progress header (120×8 bar at 25%), checklist rows (done rows struck-through + green DONE pill; pending rows "Start →" → shift types / builder / settings), footer "Optional — set up later" (Add a supplier, Add items).
- **Established state:** "Good morning, Troy." + "Week of 23 Jun". **4 KPI tiles** — Hours this week **142h** (Forest, "+18h pending" in `#D97706`), Est. labour cost **~$4,820** ("estimate only — not payroll"), On leave today **2** (Marcus · Liam), Certs expiring **3** (blue, → certs). Quick actions: Build roster (Forest), View timesheets, Approve leave (badge 1). **Recent activity card** = first 3 notifications + "View all →".
- **Components:** KpiTile ★, Button, Card, checklist card, progress bar, activity list.
- **Blocks:** `blocks/dashboard-kpi-tile.png`, `blocks/dashboard-quickactions.png`, `blocks/dashboard-activity.png`.

---

## Rosters

### Roster periods `/rosters` — screens/rosterlist-*
- **Purpose:** list of roster weeks. Header + "New roster period" (Forest).
- **Content:** one list card, each row = 42px tint calendar tile, week label + sub (Next/This/Last week), status badge (COLLECTING AVAILABILITY / DRAFT / PUBLISHED), staff count, response meta, **Build** (Forest) or **View** (ghost). Footer "Older periods are archived automatically after 12 weeks." Data: 30 Jun–6 Jul collecting; 23–29 Jun draft; 16–22 & 9–15 Jun published.
- **Interactions:** New period → toast "New roster period created — 30 Jun – 6 Jul"; Build/View → builder.

### Roster builder ★ `/rosters/:week` — screens/builder-*, blocks/builder-cell-*
- **Purpose:** flagship weekly scheduler. Header: title + DRAFT/PUBLISHED badge, week stepper "Week of 23 Jun 2026" ‹ ›, "6 staff · 31 shifts rostered", actions "Draft from last week" (ghost, `auto_awesome`) + **Publish roster** (Forest).
- **Grid card:** sticky header + sticky first column; columns "Staff member" + 7 days (day header = name+date + Forest count pill); rows = staff (avatar, name, role) × 7 cells; footer "Open shifts" row.
- **Cell variants** (build all four): Shift (tinted, `3px` stripe, availability dot, name+time, hover-lift) · On leave (grey hatch) · Open (dashed, "Open · {type}", "0 claimed · tap to assign", hover→green) · Empty (faint `+`, hover tint). Legend below.
- **States:** draft ↔ published. Publish → badge flips, a "Published" confirmation + copy-link button appear, toast **"Roster published — 6 staff notified"**. "Draft from last week" → toast. Share → toast "Share link copied — roster.zaleit.com.au/r/troys-kebabs". *(While impersonating, Publish routes through the write-confirm modal — see surface 05.)*
- **Components:** roster-builder cell ★, PageHeader, week stepper, Badge, Button.

### Availability requests `/rosters/availability` — screens/request-*
- **Purpose:** collect who's free before building. Header "Availability — Week of 30 Jun" + COLLECTING badge; actions "Send reminder" (ghost) + "Start building" (Forest). Progress bar + "N of 6 replied".
- **Content:** availability matrix ★ — `180px + repeat(7,1fr)` grid, staff rows × day cells, coloured dot per cell (Available `#16A34A` / Partial `#D97706` / Off `#9CA3AF`) or faint "no response yet" dot. Legend below.
- **Interactions:** Send reminder → toast; Start building → builder.

### Shift types `/rosters/shift-types` — screens/shifttypes-*
- **Purpose:** manage shift definitions. Header + "Add shift type" (Forest). 3-column card grid.
- **Content:** shift-type card ★ per type (top 8px colour bar, swatch+name, Edit, time pill, "Used in N shifts"); Morning 6:00am–2:00pm, Afternoon 2:00pm–10:00pm, Close 6:00pm–close, Split varies. Plus dashed "New shift type" card with colour-swatch preview.
- **Interactions:** Add → toast "Shift type added".

### Timesheets `/timesheets` — screens/timesheets-*, blocks/timesheets-row.png
- **Purpose:** review clock-in records, approve hours before export. Header + "Export approved hours (CSV)" + disclaimer "Export shows approved hours × entered rates. Estimate only — not a payroll calculation." Filter row: date range chip, status chip, live tally "6 approved · 4 pending · 1 needs fix".
- **Table:** Staff / Day / Clock in / Clock out / Hours / Shift / Status (12 rows). Notable cells: `wrong_location` warning icon when GPS was outside radius (Marcus, "Clocked in 320m outside the 200m radius"); inline **Approve** on pending rows; badges APPROVED / PENDING / STILL CLOCKED IN / NO CLOCK-OUT. Hours tabular-nums.
- **Interactions:** Approve → toast "Timesheet approved"; Export → toast "Exported 9 approved entries to CSV".
- **States per row:** approved · pending (has Approve action) · still-clocked-in · no-clock-out · gps-flagged.

### Reports & analytics `/reports` — screens/reports-*
- **Purpose:** labour & hours overview. h1 "Labour & hours" + estimate disclaimer + range segmented control (This week / Last 4 weeks / Custom range).
- **Content:** 4 KPI tiles — Total approved hours **142h** (Forest), Estimated labour cost **$4,820** (warning icon), Pending not costed **+18h**, Staff without rates **2** (warning). Two-column row: "Approved hours by week" bar-list (4 weeks, current-week bar `#13301F`, others `#B7CFBE`, hours + est cost) + staff cost table (Staff / Rate / Hours / Est. cost; no-rate rows show amber "No rate set"). All costs labelled estimates.

### Templates `/rosters/templates` — screens/templates-*
- **Purpose:** save/apply reusable week patterns. 3-column card grid.
- **Content:** template card (dashboard_customize tile, Edit, name+desc, "N shifts / N staff", footer updated-date + Apply→Forest) + dashed "Save current week as template" card.
- **Interactions:** Apply → toast "Applied to Week of 30 Jun — review and publish"; Save → toast "Current week saved as a template"; Edit → toast.

---

## Team

### Staff `/staff` — screens/staff-*, blocks/staff-detail.png
- **Purpose:** roster of team members + per-person detail. Header + "Add someone" inline bar (name + email + "Add to team"). Two-column: left list (340px) of staff cards (avatar, name, role·email, chips ON LEAVE / ⚠ CERT; selected = Forest border+tint) + right detail panel ★.
- **Detail panel:** 54px avatar, name, role·email, "Generate PIN"; two columns Pay rate (big `/hour`, "rate label, informational only") / Staff notices ("Copy notices link" → PIN-gated `/me`); Certifications list (status icon + name + detail + VALID/EXPIRING SOON/EXPIRED); Documents (Drive-backed: "Drive connected · owner@gmail.com", doc rows Open/delete, "Upload document" + "Disconnect Drive") **or** empty state **or** a dashed "Connect Google Drive" promo. Copy: documents live in the owner's own Drive, not Roster's servers.
- **Interactions/toasts:** Add → "Team member added — sign-in link sent"; Generate PIN → "New PIN generated and sent to {first}"; Copy notices → "Notices link copied — roster.zaleit.com.au/me/sh-7f3a"; Upload → "Document uploaded to Google Drive".
- **States:** Drive connected (docs) · connected-empty · not-connected (promo).

### People (all sites) `/people` — screens/people-*
- **Purpose:** cross-location roster of everyone; place a person into any site. Info banner (blue): dark chip = home location; green chips = lent-to sites (removable); "Time-boxed loans are coming soon."
- **Content:** table `1.6fr / 2.4fr` (Team member / Location memberships); each row = avatar + name + "role · home: {site}" and location chips (home = Forest fill + `home` icon; lent = tint chip + removable `close`) + "Place at site" dashed button.
- **Interactions:** remove chip → toast "{first} removed from {site}"; Place at site → toast.

### Leave requests `/leave` — screens/leave-*
- **Purpose:** approve/deny leave. Header + info banner (blue) "Leave is recorded for scheduling purposes. Balances and accruals are managed by your payroll provider."
- **Content:** list card, each request = avatar, name + leave type, dates + day count, quoted reason, and **Deny / Approve** (pending) **or** APPROVED/DENIED badge (decided). 5 requests, 2 pending.
- **Interactions:** Approve/Deny mutate row status + notify.

### Certifications `/certs` — screens/certs-*
- **Purpose:** track staff certs & expiry. Header + auto-reminder pill "Reminder emails sent automatically" + filter toggle "Show expiring & expired only" (Forest when active).
- **Content:** table Staff / Certification / Expiry / Status (icon + badge) / Days left. Statuses VALID / EXPIRING SOON / EXPIRED / NONE RECORDED. 10 rows (RSA, Food Safety, First Aid).
- **States:** filter off (all) / on (expiring+expired only).

### Forms `/forms` — screens/forms-*
- **Purpose:** build custom forms & collect responses. **Three sub-views** (`formsView`): list / builder / responses.
- **List:** 2-col card grid; form card (assignment tile, name + LIVE/DRAFT badge, desc, "N fields / N responses", Edit + Responses) + dashed "Create a form".
- **Builder:** editable title input (underline-on-focus), side-split: field list (drag handle, type icon, label, Required toggle, delete) + a sticky "Add a field" palette (short_text/date/choice/etc.). "Save form" → toast.
- **Responses:** side-split: respondent list (340px, avatar + submitted-at + badge) + answer panel (Q labels + answers). Footer: "Documents are stored in the owner's Google Drive, not on Roster's servers."

---

## Orders

### Stock levels `/stock` — screens/stock-*
- **Purpose:** stock-check results. Header + red pill "N need ordering". Table Item / Supplier / Checked by (mini avatar) / Checked at / Status. Needs-order rows = faint red bg + "Order reminder sent" sub-note. Statuses NEEDS ORDER / OK. 8 rows.

### Items / SKUs `/items` — screens/items-*
- **Purpose:** SKU catalogue. Header + "Import from CSV" + "Add item". Optional **CSV import preview card** (green-accented, appears on Import): parsed rows (Item / SKU / Category) with add-circles, "…and 20 more", Cancel / "Import 24 items". Main table: Item / SKU (mono) / Category chip / Supplier / Reorder / Unit. 11 items.
- **States:** default / CSV-preview open.

### Suppliers `/suppliers` — screens/suppliers-*
- **Purpose:** supplier directory. Header + "Add supplier". 2-col card grid; supplier card ★ (`local_shipping` tint tile, name + category chip, edit, email + phone rows, delivery-day chip row Mon–Sun with active days Forest) + dashed "Add a supplier" form card (name/contact inputs, day picker, dark "Add supplier").

---

## System

### Settings `/settings` — screens/settings-*
Two columns of cards:
- **Account:** avatar, email, "Signed in", Business "Troy's Kebabs", "Display only — contact support to change".
- **Clock-in:** Kiosk link (readonly + Copy + Generate new), Personal phone link (Copy + Regenerate), **Require GPS** toggle + radius select (100/200/500 m), **Require photo on clock-in** toggle, **Photo retention** select (7/30/90 days).
- **Notifications:** 6 toggle rows — Leave requests submitted, Shift released/claimed, Stock marked needs-ordering, Certifications expiring, Availability replies, Team notices.
- **Google Drive:** connected (as `owner@gmail.com`, folder "Roster Documents", Disconnect) or connect promo.
- **Interactions:** all toggles are optimistic switches; Copy/Generate → toast with the URL.

### Locations `/locations` — screens/locations-*, blocks/geofence-control.png
- **Purpose:** venues + per-site GPS geofence. Header + "Add location" (Forest). Side-split: location list ★ (selectable cards, HOME badge, staff-count + radius) + detail panel with **geofence radius control ★** (hatched map preview, scaling Forest circle, `[100,150,200,500]m` buttons, "Require GPS at this site" toggle).
- **Interactions:** select card → detail; radius button → resizes circle; Add → toast "New location added — set its address and geofence".

### Xero integration `/xero` — screens/xero-*, blocks/xero-mapping-row.png, blocks/xero-split-preview.png
- **Purpose:** push approved hours to Xero for a human to finalise. Header icon tile (`#13B5EA`) + h1 + **honesty subhead "Push approved hours to Xero for a human to finalise. Roster never interprets awards or calculates pay."** Sub-tabs: Connect / Employee mapping / Push hours / Pay rules.
- **Connect states** (`xeroConn`): *disconnected* — "Connect your Xero organisation" + "Invite your bookkeeper" + red note "If you see 'payroll-admin access required', your Xero login can't manage payroll — ask your bookkeeper to connect instead." · *pending* — SECURITY CHECK badge, "Confirm this is your organisation" (Troy's Kebabs Pty Ltd, ABN), "Yes, that's my business" / "No, cancel" · *connected* — "Connected to Troy's Kebabs Pty Ltd", ACTIVE badge, Disconnect / Reconnect.
- **Employee mapping:** "N of 6 matched" + red "N unmatched — excluded from push" pill; mapping table (xero mapping row ★); footnote "Ordinary rate is read from each Xero employee. Roster never sets or overrides it."
- **Push hours:** blue honesty banner "Hours push under a single **ordinary rate** unless one of your pay rules classifies them. Penalty and overtime rates must be confirmed by a human in Xero — Roster does not finalise pay." Preview card (per-employee hours + breakdown; "Aisha Khan is unmatched and will be skipped"); Push → confirmed state ("Hours pushed to Xero", "5 employees updated as draft. Review and finalise in Xero.", per-row "Review in Xero →", skipped-row danger strip).
- **Pay rules:** Forest honesty banner "**Your rules, your pay items — Xero does the maths.** Roster ships no default rules and never suggests a rate or interprets an award." Empty state "No pay rules — and that's on purpose". Rule rows (pay-rules row ★) with first-match-wins reorder + per-shift split preview ★.
- **States:** disconnected / pending / connected × 4 sub-tabs; rules empty / non-empty; push not-pushed / pushed.

### Notification centre `/notifications`
- Reuses the dashboard **with the bell dropdown open** (see bell component). Treat as the bell, not a separate page. `notifcentre` is a full-page list variant of the same notifications.
