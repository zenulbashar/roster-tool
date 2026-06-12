# CLAUDE.md

Guidance for AI agents (and humans) working in this repo. Keep this file
current as conventions and architecture evolve.

## What this is

A dead-simple roster (staff scheduling) tool for small, non-technical business
owners (cafés, restaurants). Mobile-first, high-contrast, zero jargon. Every
screen should be understandable in 5 seconds by someone who has never used
scheduling software.

## Product scope (MVP — do not exceed without flagging)

In scope: owner sign-up + business, add staff, shift templates, roster periods,
availability requests via staff magic links, availability summary, roster
builder, publish (personal emails + read-only shareable view), one automatic
reminder before the deadline, staff clock-in (a shared-device kiosk with
per-staff PINs **and** a personal-phone GPS-checked mode) feeding owner-facing
timesheets, per-employee pay rates, a CSV export of approved hours, staff
**leave requests** with owner approval (record only — see below), and
**shift swaps / open shifts** (one-directional release → claim → owner
approves — see below), and **certification / qualification tracking** with
owner expiry reminders (flagged, never enforced — see below), and
**inventory** — owner-managed **items (SKUs)** with CSV upload and **suppliers**
with delivery days (**Part 1**: tracking — see below), plus **staff stock checks**
(PIN, both clock surfaces) feeding an owner **Stock** view and **daily order
reminders** before each supplier's delivery (**Part 2**: flagged/reminders only,
never places orders — see below), and **hours & labour-cost reporting** — a
read-only owner report page + dashboard summary over existing timesheets/rates
(hours and an `hours × rate` **estimate**, never a payroll calculation — see
below), and **owner in-app notifications** — a header bell (unread count +
dropdown) fed by the existing events, with per-event on/off preferences
(see below), and **staff in-app notices** — a per-staff PRIVATE notices page
(`/me/<token>` capability link, PIN-gated) fed by leave decisions, swap
approvals and roster publishes, plus a daily **in-app-only shift reminder**
("you work tomorrow" — never an email), all IN ADDITION to the existing staff
emails (see below).

**Out of scope (post-MVP):** SMS/WhatsApp, **payroll / wage calculation**
(award interpretation, penalty rates, overtime, loading, super, STP — the app
only records hours and a rate the owner typed, and shows an `hours × rate`
estimate), **payroll API integration** (Xero/MYOB — file export only),
**leave balances / accruals / entitlements** and any **NES/award leave
calculation** (leave is request → approve/deny → record only),
**persistent staff logins/accounts** (staff notices use a per-staff capability
link + PIN with a SHORT-LIVED signed proof, never a session or account),
**email for the daily shift reminder** (it is in-app ONLY, protecting the email
send limit) and any **real-time/websocket push** for notifications (the owner
bell and the staff notices page are server-driven, refreshing on
navigation/refresh),
**bilateral A↔B shift swaps** and **auto-approval** of swaps (the owner always
approves the handover; only one-directional release/claim is built),
**certificate document upload/storage** and any **hard enforcement** of
certification expiry (certs are text + dates, flagged and reminded only — they
never block rostering or clock-in),
any **actual ordering, purchasing, supplier-system integration, pricing,
invoicing or payments** (the inventory feature is tracking + reminders only — it
never places orders), **reorder thresholds / par levels** (stock status is
staff/owner-set, never auto-computed from a threshold — a possible future
option), and **object storage** (inventory CSV is pasted text / parsed in
memory, no file store),
free-text reply parsing, billing, native apps,
continuous/background location tracking. If a request drifts here, flag it
rather than silently building it.

Note: clock-in/timesheets was added after the original MVP (time clocking used
to be listed out of scope) at the owner's explicit request. It captures hours +
owner approval, not payroll export.

## Stack

- Next.js (App Router) + TypeScript
- PostgreSQL + Drizzle ORM (migrations in `drizzle/`)
- Auth.js (`next-auth@5`) — owner auth via **email magic link**
- Email: Resend in production; Mailpit (local SMTP catcher) in development.
  Selected by `EMAIL_TRANSPORT` (`smtp` | `resend`).
- pg-boss — Postgres-backed background jobs
- Tailwind CSS v4 (CSS-first config in `src/app/globals.css`)
- Vitest — unit + integration tests
- pino — structured logging

## Key product decisions

- **Shifts**: business defines reusable **shift templates** (label + start/end +
  weekday flags). Creating a roster period expands templates into concrete
  shifts per day.
- **Availability**: per-shift yes/no (Available / Not available). 1:1 mapping to
  assignments.
- **Owner auth**: email magic link. First sign-in creates the Business.
- **Account clarity** (after an incident where owners signed in with a
  different email than they realised and thought their data was lost): the
  onboarding page shows "You're signed in as <email>" + a hint that an
  existing owner may have used another address, with a Sign out button
  (redirecting to `/sign-in`; the header's sign-out keeps going to `/`);
  Settings has an **Account** card (signed-in email + business name —
  display only, NO email change/management). The shared block is
  `src/components/AccountIdentity.tsx`; the email always comes from the
  server-side session, and a null email renders nothing. A **unique index on
  `lower(email)`** on the `user` table guards against case-variant duplicate
  accounts at the DB level — a pure guard, not a behaviour change, since the
  sign-in form and Auth.js's normalizer already lowercase every address
  (automatic business relinking is deliberately NOT built).
- **Clock-in kiosk**: a shared-device page reached by a per-business capability
  link (`/kiosk/<token>`), with NO owner session. Like the staff magic link and
  public roster, the token (then an httpOnly cookie) authenticates the device and
  yields the `businessId` via `resolveKioskBusiness` in
  `src/lib/tenant/kiosk-access.ts`; all further work is scoped through
  `createTenantRepo(businessId)`. The kiosk can only read active staff
  names + clock state and write clock entries/photos — never owner pages or other
  tenants. Per-action auth is the staff member's PIN. The owner rotates the link
  (regenerates the hash) to instantly revoke old links.
- **Clock-in photos** (`require_clock_in_photo`, off by default): when on, the
  kiosk captures a webcam still at clock in/out, stored as `bytea` in
  `clock_photo`. Privacy: a consent line shows on the kiosk; **no facial
  recognition**; photos live in our Postgres DB and are served only to the owner;
  deleting a timesheet entry deletes its photos. Photos are also **auto-purged
  per business** by a daily retention job (`photo_retention_days`, default 7;
  owners pick 7/30/90 in Settings) — only the photos are deleted, the timesheet
  entry/hours are always kept. Camera-denied/unavailable falls back to PIN-only;
  a missing photo never blocks clocking.
- **Personal-phone GPS clock-in** (`/clock/<token>`): a SEPARATE flow from the
  shared kiosk, for staff clocking in on their own phones. Reached via a
  distinct capability token (`personal_clock_token_hash`) — NOT the kiosk token
  — so a personal phone only ever gets the location-checked route (no no-GPS
  bypass). Same PIN auth + per-staff lockout as the kiosk, scoped via
  `resolvePersonalClockBusiness` → `createTenantRepo`. On the tap we read the
  phone's coordinates **once** (no background/continuous tracking), compute the
  Haversine distance (`src/lib/geo.ts`) to the business location, and require it
  within `geofence_radius_m`. Outside the radius is **blocked** (clear message);
  a denied/absent fix is **blocked** too (never silently allowed); if the shop
  location isn't set, it's blocked. Captured `clock_in_lat/lng` + `within_geofence`
  are stored so the owner sees it was location-verified. Privacy: a consent line
  shows on the screen ("Your location is checked when you clock in to confirm
  you're at work"); location is read only at the tap. The OWNER editing/adding
  entries on the timesheets page is the release valve, so no one is ever stuck.
  The shared kiosk is **never** location-checked (a fixed tablet's location
  proves nothing). No photo on the personal route (PIN + GPS only).
- **Pay rates & hours export**: each staff member can carry an hourly
  `pay_rate_cents` + `rate_type` (`flat`/`award`) + `rate_label`. This is a
  **stored number + label only** — the app does NOT interpret awards or
  calculate wages. The owner can export a week's **approved** hours as CSV
  (`src/lib/timesheet-export.ts`): staff, date, in/out, hours, rate, an
  `hours × rate` **estimate**, and a location-verified flag, in the business
  timezone. The CSV and the UI both state prominently that this is NOT a payroll
  calculation; penalty rates, overtime, super and final pay are the
  owner's/payroll system's job. No Xero/MYOB API — file export only.
- **Hours & labour-cost reporting**: read-only analytics over data the app
  already collects (timesheets + the rate the owner typed). An owner **report
  page** (`/app/reports`, in the Rosters nav group) and a compact current-week
  **summary on the owner dashboard** (`/app/page.tsx`). Owner-selectable time
  window — current week (default), last 4 weeks, or a custom from/to range (all
  query-param driven, business-local weeks, Monday-start). Per staff member it
  shows worked hours and an **estimated labour cost = hours × the entered
  hourly rate**, summed to a business total, plus a per-week breakdown
  (lightweight CSS bars — no chart dependency) for trend visibility.
  - **Cost is from APPROVED, closed entries only** (the owner's payroll
    sign-off, mirroring the CSV export). **Hours are split** into APPROVED (the
    cost basis) and PENDING (unapproved, shown but **not costed**) so a live
    current week isn't misleadingly empty. **Open entries** (no clock-out) have
    no defined duration → excluded from hours/cost and surfaced as a note.
    **Staff with no rate set** contribute hours but a **null cost** (never $0)
    and are flagged. Per-entry hours are rounded to **2dp before summing**
    (matching the CSV) so the report and the export agree.
  - **CRITICAL FRAMING — estimate only**: every cost figure is an ESTIMATE
    (hours × the entered rate). It is **NOT a payroll calculation** — no penalty
    rates, overtime, super, loadings or award interpretation (same wording as
    the CSV export; `LABOUR_COST_DISCLAIMER` is shown wherever cost appears).
  - **No new data, no writes, no schema change.** The aggregation is a pure,
    unit-tested function (`src/lib/labour-report.ts`: window resolution, hours,
    per-entry cost, weekly bucketing) separate from the tenant-scoped, windowed
    read (`listEntriesForLabourReport`). Tested at week/timezone boundaries
    (`tests/labour-report.test.ts`) and end-to-end against Postgres
    (`tests/labour-report-flow.test.ts`).
- **Owner in-app notifications**: a header **bell** with an unread count + a
  dropdown of recent notifications, plus a full list at `/app/notifications`
  (reached from the bell, **not** in the nav) and per-event on/off **preferences**
  in Settings. **Owner only** — the staff analog is the separate staff notices
  system (`/me`, see "Staff in-app notices" below). These are **IN ADDITION to
  the existing emails**, never a replacement.
  - **Five event types** (`notification_type`): `leave_requested`,
    `shift_offer_activity` (released or claimed), `stock_needs_order`,
    `cert_expiring`, `availability_reply`. The set is fixed.
  - **Creation is best-effort + preference-gated.** `notifyOwner(repo, {...})`
    in `src/lib/notifications.ts` reads the business's prefs, **skips** if the
    type is off, else inserts — all wrapped in try/catch that logs and **never
    throws**, so a notification failure can't break the underlying action
    (leave/stock/clock/availability still succeed). Pure `prefEnabled` /
    `relativeTime` are unit-tested.
  - **Where they're created** (after the successful write, tenant-scoped, the
    `businessId` from the event's own server context — never client input):
    `submitStaffLeave`, `releaseShiftForStaff`/`claimShiftForStaff`,
    `submitStockCheck` (only when an item is flagged `needs_order`) — all in the
    **shared submission cores**, so BOTH the kiosk and personal-phone surfaces
    are covered in one place — plus the `/a/[token]` availability reply action
    and the worker's `cert-reminder` job (mirrors the digest; the **email is
    unchanged**, only the extra in-app row is pref-gated).
  - **Preferences are five boolean columns on `business`** (`notify_*`, all
    default true) — a fixed five-event set makes columns simpler than a side
    table (no row-existence/default ambiguity). Toggled in Settings via a
    tenant-scoped action.
  - **The bell is server-driven** (no websockets): the owner layout reads the
    unread count + recent list per request (owner pages are dynamic), so it
    refreshes on navigation/refresh. Clicking an item marks it read and
    navigates (tenant-scoped `markNotificationRead`, foreign id no-ops; redirect
    restricted to internal `/…` paths); "mark all as read" clears the rest. All
    reads/writes are scoped via `ownerRepo()`.
- **Staff in-app notices**: a per-staff PRIVATE notifications page at `/me`,
  plus a daily in-app shift reminder. **IN ADDITION to the existing staff
  emails (leave decisions, swap approvals, published rosters) — never a
  replacement; no email is removed or changed.** Still NO persistent staff
  login: the page uses a capability link + PIN.
  - **The /me capability link is PER STAFF MEMBER** (`staff_member.
notices_token_hash`, generated/rotated by the owner on the Staff page,
    raw link shown once — exactly the kiosk-link pattern). `/me/<token>`
    validates, drops the token into an httpOnly cookie scoped to `/me`
    (`resolveNoticesStaff` in `src/lib/tenant/notices-access.ts` — inactive
    staff and rotated tokens don't resolve), and redirects clean. The link
    identifies WHO; because the page shows personal info it then **requires
    that staff member's PIN** (same verify + per-staff lockout as the clock
    surfaces) before anything is shown.
  - **The PIN check is kept alive by a SHORT-LIVED signed proof, not a
    session**: a correct PIN sets a second httpOnly cookie (`staffId.expiry.
hmac`, AUTH_SECRET-signed, 15 min — `src/lib/notices-verification.ts`,
    unit-tested for expiry/tamper/identity). Every render AND every action
    re-checks both cookies and that the proof is bound to the SAME staff
    member the token resolved to. Nothing stored server-side; it expires and
    the PIN is re-entered.
  - **Strict per-staff scoping**: all reads/writes go through repo methods
    that filter by `business_id` AND `staff_member_id` (foreign ids no-op);
    the staff member is always derived from the token hash, never client
    input. No path from /me into /app or another person's data.
  - **Four notice types** (`staff_notification_type`): `leave_decided` (owner
    approves/denies a request — beside the decision-email enqueue),
    `shift_swap_approved` (offer approval — the claimer, and the releaser if
    any, beside the approval emails), `rostered` (publish — each
    confirmed-assignment staff member, beside the roster emails), and
    `shift_reminder` (the daily job). The first three are created in the
    owner server actions via **best-effort `notifyStaff`**
    (`src/lib/staff-notifications.ts`) — a notice failure never breaks the
    decision/publish.
  - **Daily shift reminder job** (`staff-shift-reminder`, 07:00 UTC ≈ 5–6 pm
    Sydney, beside the other daily crons): per business, one "you work
    tomorrow" notice per staff member with a confirmed assignment on
    tomorrow's business-local date in a PUBLISHED roster (inactive staff and
    suggested assignments excluded). **IN-APP ONLY — the handler never touches
    the mailer.** Idempotent per staff per date via `dedupe_key`
    (`shift_reminder:<staffId>:<date>`, unique index + ON CONFLICT DO
    NOTHING), so re-runs/retries are no-ops; inserts are NOT best-effort in
    the job so real failures throw and pg-boss retries. Pure grouping/message
    logic in `src/lib/staff-shift-reminder.ts`. Owner can turn the reminder
    off per business (`staff_shift_reminders_enabled`, Settings → "Team
    notices", default on).
- **Owner getting-started checklist**: a "Getting started" card at the top of
  the owner dashboard (`/app`) walking a new owner through setup. **Step state
  is DERIVED from existing data — never a manual checkbox**: four CORE steps
  (add staff → `staff_member` exists; create a shift type → `shift_template`
  exists; build a roster → `roster_period` exists, any status; set up clock-in
  → `kiosk_token_hash` OR `personal_clock_token_hash` is set) plus two
  clearly-labelled OPTIONAL inventory steps (a `supplier` / an `item` exists)
  that are bonus nudges only. Each incomplete step links to the page where the
  owner does it; progress reads "N of 4 done". **The card auto-hides once all
  four core steps are complete** — optional steps never keep it visible — and
  there is NO stored dismiss flag (visibility is purely derived; no schema
  change, read-only). Flags come from one tenant-scoped round trip of scalar
  EXISTS subqueries (`getSetupFlags` on the repo); the pure step/visibility
  logic is `buildGettingStarted` in `src/lib/getting-started.ts`
  (unit-tested in `tests/getting-started.test.ts`, tenant isolation in
  `tests/getting-started-flow.test.ts`); the card is
  `src/components/GettingStartedCard.tsx`. **NOT employee onboarding** — owner
  setup only.
- **Leave requests & approvals**: staff request time off, the owner approves or
  denies. **Record only** — NO leave balances, accruals or entitlements, and NO
  NES/award/payroll leave calculation; it's purely request → approve/deny →
  record. A `leave_request` carries a `leave_type` (`annual`/`sick`/`unpaid`/
  `other`), an inclusive `start_date`/`end_date` (calendar dates, like shift
  dates), an optional note, and a `status` (`pending`/`approved`/`denied`).
  - **Staff submission** reuses the existing per-staff PIN auth — no new login.
    A "Request leave" option lives in BOTH the personal-phone (`/clock`) and the
    shared kiosk (`/kiosk`) PIN flows; the business comes from that flow's
    capability token (never client input), the staff member is authenticated by
    PIN with the same per-staff lockout as clock-in, and a valid submission
    creates a `pending` request. The shared core is `submitStaffLeave` in
    `src/lib/leave-submission.ts`. **No geofence** — requesting time off isn't a
    clock action, so (unlike personal-phone clock-in) it's allowed from anywhere.
  - **Owner Leave page** (`/app/leave`, in the nav): review pending requests
    (Approve / Deny → sets `status` + `decided_at`), a list of upcoming approved
    leave (with Remove), and a "Record leave" form to enter leave on a staff
    member's behalf — saved straight as `approved` for the "they told me
    verbally" case (no email). All actions are business-scoped via `ownerRepo()`.
  - **Decision emails**: approving/denying a staff request enqueues a pg-boss
    `leave-decision` job (`handleLeaveDecision`) that emails the affected staff
    member via Resend. Idempotent via `decision_notified_at` (set only after a
    successful send), like availability `sent_at`. Owner-recorded leave sends no
    email; the owner sees pending requests in-app.
  - **Roster integration**: a pure helper (`isOnLeave` / `makeOnLeaveLookup` in
    `src/lib/leave.ts`) answers "is this staff member on approved leave on this
    day?". The roster builder flags any staff member with approved leave
    overlapping a shift's date with an **"On leave"** marker, and "draft from
    last week" won't suggest someone on a day they're on approved leave (via the
    optional `isOnLeave` arg to `buildDraft`). It's a flag, not a hard block —
    the owner can still assign them manually if they choose.
- **Shift swaps / open shifts**: one-directional **release → claim → owner
  approves**. A staff member offers up a confirmed shift they hold in a
  PUBLISHED roster (or the owner posts an unassigned published shift as open);
  another staff member claims it; the **owner approves**, which transfers the
  assignment. **NO bilateral A↔B swaps, NO auto-approval, and offers only exist
  on published rosters.** A `shift_offer` carries the `shift_id`, an
  `offered_by_staff_id` (NULL when the owner posted an open shift),
  `claimed_by_staff_id`, and a `status`
  (`open`/`claimed`/`approved`/`denied`/`withdrawn`).
  - **Never leave a shift uncovered**: releasing does NOT touch the releaser's
    `roster_assignment`. The releaser stays assigned until the owner approves a
    replacement, at which point the transfer happens atomically.
  - **Staff release/claim/cancel** reuse the per-staff PIN auth (same lockout,
    no geofence — not a clock action) in BOTH the personal-phone (`/clock`) and
    shared kiosk (`/kiosk`) flows: a "My shifts" view (offer up / cancel your
    own open offer) and an "Open shifts" view (claim). The shared cores are in
    `src/lib/shift-offer-submission.ts`; the business always comes from the
    flow's capability token, never client input. A staff member can't claim
    their own released shift or one they're already on; claiming while on leave
    or with a same-day overlap is **flagged, not blocked**.
  - **Owner Shifts page** (`/app/shifts`, in the nav): review pending claims
    (Approve / Deny) with leave/overlap conflict flags, withdraw still-open
    offers, and post an unassigned published shift as claimable.
  - **The transfer** (`approveOffer`, in one DB transaction): re-check the offer
    is still `claimed` and the roster still published, assign the claimer as a
    CONFIRMED `roster_assignment`, remove the releaser's assignment (only when
    there was a releaser), and set the offer `approved`. **Deny is final**
    (`denied`, no assignment change). At most one ACTIVE (`open`/`claimed`)
    offer per shift (partial unique index).
  - **Notifications**: approval enqueues a pg-boss `shift-offer-decision` job
    (`handleShiftOfferDecision`) emailing the claimer ("you're confirmed") and,
    if there was a releaser, the releaser ("now covered by …"). Idempotent via
    `decision_notified_at`. Deny/withdraw send no email.
  - **Builder visibility**: shifts with an active offer show an
    **"Offered"**/**"Claimed"** marker; the handover only happens on approval.
- **Certification / qualification tracking**: each staff member can carry
  certifications (`rsa`/`rsg`/`food_safety`/`first_aid`/`wwcc`/`other`) with an
  `expiry_date`, an optional label (required for `other`) and reference number.
  **Text + dates only — NO document upload/storage.** Expiry is **flagged and
  reminded only, NEVER enforced** (it never blocks rostering, clock-in or
  anything else), and there's **no award/compliance interpretation** beyond the
  expiry date.
  - **Owner management + overview** live on `/app/certifications` (in the nav):
    add/edit/delete certs (tenant-scoped `ownerRepo()` actions, zod-validated),
    a list sorted by soonest expiry with a **Valid / Expiring soon / Expired**
    badge each, and a 30/60/90 reminder lead-time selector saved on the
    business. Day-of-expiry counts as **Expired** (badge and the expired alert
    aligned).
  - **Daily reminder job** (`cert-reminder`, scheduled 02:00 UTC in the worker
    boot path beside photo-retention) emails the **owner** a single consolidated
    digest per business of certs crossing a threshold: an early notice at the
    lead time (`business.cert_reminder_lead_days`, default 30), a final notice
    at 7 days, and an alert on/after expiry. **Idempotent per cert via
    `last_reminder_stage`** — each stage emails at most once; the cursor only
    advances after a successful send and resets to null when the expiry date
    changes. Only active staff's certs are considered. Pure status/stage logic
    is in `src/lib/certification.ts`.
- **Inventory: items (SKUs) + suppliers (Part 1 — tracking only)**: owner-managed
  stock records. **This build does NOT place orders, integrate with any supplier
  system, track quantities, price, or invoice — it's record-keeping foundations
  only.** Stock checks (staff stock-marking) and order reminders (scheduled jobs)
  are **Part 2**, a planned follow-up, not built here.
  - **Suppliers** (`/app/suppliers`, in the nav): add/edit/delete a supplier —
    name, contact, email, phone, the weekdays they deliver (a Mon–Sun
    multi-select stored as `delivery_days`, **ISO 1–7** to match
    `shift_template.weekdays`), an `order_cutoff_days_before` number ("order by X
    days before delivery" — **stored now, used by the Part 2 reminder job; no
    effect in this build**), and notes. Tenant-scoped `ownerRepo()` actions,
    zod-validated.
  - **Items / SKUs** (`/app/items`, in the nav): add/edit/delete/deactivate an
    item — name (required), `sku_code`, `unit` (free text e.g. "kg"/"box"/"each"),
    and an optional `supplier` (a select of the business's own suppliers; a
    foreign/unknown id is coerced to null by `resolveOwnedSupplierId`, never
    linking another tenant's supplier). `is_active` retires an item without
    deleting its history.
  - **CSV import** (`/app/items/import`): the owner **pastes CSV text** (no file
    upload, no object storage). Two-step **preview → confirm**, both driven by
    server actions that take only the RAW text and re-parse it server-side under
    the owner's tenant scope (the client never sends parsed rows). Preview shows
    per-row status, matched-vs-unmatched suppliers and counts; **confirm
    re-validates from scratch** and inserts only the valid rows. A downloadable
    sample template lives at `/app/items/sample`.
  - **Parsing rules** (pure, in `src/lib/item-import.ts`, hammered by
    `tests/item-import.test.ts`): RFC-4180-style tokenizer (quoted fields with
    embedded commas/newlines, doubled-quote escapes, CRLF/LF), trims unquoted
    cells, **skips blank lines**, and **detects/ignores a header row** (mapping
    `name`/`sku_code`/`unit`/`supplier_name` and common synonyms; falls back to
    positional order when there's no recognisable header). Columns: **`name`
    required**; `sku_code`, `unit`, `supplier_name` optional.
  - **Supplier matching**: `supplier_name` is matched **case-insensitively** to
    an existing supplier; a match links it, an unmatched name imports the item
    **with no supplier** (flagged in the preview, never auto-creating a supplier).
  - **Dedupe behaviour**: a row is **skipped as a duplicate** when its name OR its
    `sku_code` (both case-insensitive) already exists for the business, **or** it
    repeats an earlier row in the same upload (first occurrence wins). A row
    **missing a name is an error** — reported in the preview, **never silently
    dropped**. Only `new` rows are inserted (`bulkInsertItems`, business-scoped).
- **Inventory: stock checks + order reminders (Part 2 — flagged/reminders only)**:
  staff record what's running low; the owner sees it and gets a reminder email
  before each supplier's delivery. **This NEVER places orders, integrates with any
  supplier system, or prices/invoices anything**, and there are **no reorder
  thresholds / par levels** (status is staff/owner-set, not auto-computed).
  - **Stock status**: an item's CURRENT status is its most recent
    `stock_check_entry` (`available`/`low`/`needs_order`); each check also carries
    an optional free-text `quantity` ("2 boxes" — record-only, never parsed).
  - **Staff stock check** reuses the per-staff PIN auth (same lockout, **no
    geofence** — not a clock action) in BOTH the personal-phone (`/clock`) and
    shared kiosk (`/kiosk`) flows: a **"Stock check"** option (mode=stock) lists
    the business's ACTIVE items grouped by supplier, each with a status choice
    (leave unchanged / in stock / running low / needs ordering) and an optional
    quantity. Items left unchanged aren't recorded (their previous status stands).
    The shared core is `submitStockCheck` in `src/lib/stock-check-submission.ts`;
    the business always comes from the flow's capability token, and the item ids
    come from the repo (`listActiveItemsForStockCheck`) — the client only supplies
    statuses, never ids.
  - **Owner Stock page** (`/app/stock`, in the nav): items grouped by supplier
    with their current status, who last checked (staff name, or "Manager" when
    owner-set) and when, low/needs-ordering highlighted. The owner can **manually
    set** an item's status (records an entry with `checked_by = NULL`), so
    reminders don't depend on staff checking.
  - **Order-by date**: a supplier is due to be ordered today when its delivery
    date is exactly `today + order_cutoff_days_before` and that weekday is one of
    its `delivery_days` (ISO 1–7). Equivalent to "order-by date == today", and
    correct for multiple delivery days and cutoffs spanning a week boundary; a
    cutoff of 0 reminds on the delivery day. Pure logic in
    `src/lib/order-reminder.ts` (`orderByDeliveryDate`, `selectOrderReminders`).
  - **Daily order-reminder job** (`order-reminder`, scheduled **06:00 UTC** in the
    worker boot path beside photo-retention and cert-reminders) emails the
    **owner** ONE consolidated digest per business of suppliers due today that have
    items flagged `needs_order`/`low` ("Order from [supplier] before [delivery
    date] — Need to order: …; Running low: …"). "Today" is computed per business
    via `businessDateOf`. **Idempotent per supplier via
    `supplier.last_order_reminder_date`** — set to the delivery date after a
    successful send, so a re-run the same day is a no-op and the next cycle's
    different date re-arms it. Owner-less businesses are skipped.

## Non-negotiable conventions

### Multi-tenancy

- Every domain row carries `business_id`.
- `business_id` is ALWAYS derived from the authenticated session (owner) or a
  validated scoped token (staff). **Never** trust a client-supplied
  `business_id` from body/query/params.
- All domain reads/writes go through the tenant-scoped data-access layer in
  `src/lib/tenant/`. Don't query domain tables directly from routes.

### Time

- Store all timestamps in UTC.
- Display in the business timezone (default `Australia/Sydney`).
- Dates shown DD/MM. Use helpers in `src/lib/time.ts`; don't hand-roll
  formatting.
- Calendar dates (shift dates) and wall-clock times are stored as
  `YYYY-MM-DD` / `HH:MM` strings, not timestamps.

### Security

- Validate ALL external input with zod.
- Staff magic-link tokens are single-use-ish, scoped, and time-limited. Store
  only a **hash** of the token; compare hashes. Never log tokens or PII.
- Secrets live in env only, accessed via the validated `src/lib/env.ts`.

### Background jobs

- All email sending (availability requests, reminders, published rosters) goes
  through pg-boss jobs.
- Jobs MUST be idempotent and safe to retry.

### Observability

- Use the `logger` from `src/lib/logger.ts`. Structured logs only.
- No swallowed errors. Let jobs fail (so pg-boss retries) rather than catching
  and ignoring.

### UI / accessibility

- Semantic HTML, keyboard navigable, visible focus, WCAG AA contrast.
- Mobile-first. Minimal component set; no heavy UI kit.
- **Owner-area header/nav** (`src/app/app/layout.tsx` + `src/components/OwnerNav.tsx`):
  a Zaleit-branded **dark header** (`--color-header-bg`, green `--color-accent`
  `#76b900` wordmark — header only, content stays white) with the nav grouped into
  four top-level items: **Rosters** (Rosters/`/app/periods`, Shift types/`/app/templates`,
  Shifts/`/app/shifts`, Timesheets/`/app/timesheets`, Reports/`/app/reports`), **Team** (Staff, Leave,
  Certifications), **Orders** (Stock levels/`/app/stock`, Items, Suppliers), and a
  standalone **Settings**. The header also carries a **notification bell**
  (`NotificationBell`, right of "Sign out") with an unread count + dropdown; the
  owner layout reads the count/list per request via `ownerRepo`. `OwnerNav` is a
  client component using `usePathname` for
  active highlighting (active group + item); click-to-open dropdowns (Escape +
  outside-click close) on desktop, a hamburger panel on mobile. **Nav labels +
  grouping only** — every page keeps its current URL (`/app/stock`'s label is
  "Stock levels" but its path is unchanged).

## Running things

See README.md. Quick reference:

```bash
npm run dev:setup   # docker compose up + migrate + seed
npm run dev         # app
npm run worker      # background jobs
npm run db:generate # create migration from schema diff
npm run db:migrate  # apply migrations
npm run db:seed     # demo data
npm run typecheck && npm run lint && npm test
```

## CI

`.github/workflows/ci.yml` runs on every push/PR: `npm ci`, migrate (against a
Postgres service), typecheck, lint, format check, test. Keep it green.

## Deployment

Production runs on Vercel (web app) + Railway (worker, via `Dockerfile`) +
Neon Postgres + Resend. Per-platform env templates: `.env.vercel.example` and
`.env.railway.example`. Step-by-step instructions are in README →
"Production deployment". Key gotchas: the worker needs `APP_URL` and
`AUTH_SECRET` set (env validation is global); Vercel uses Neon's pooled
connection, the worker uses the direct connection (pg-boss needs session mode).

## Working method

- Small, reviewable commits — one logical change each.
- Write tests alongside features.
- Update this file and README milestone checklist as things land.

## Data model

`business`, `user` (owner) + Auth.js tables, `staff_member`, `shift_template`,
`roster_period`, `shift`, `availability_request`, `availability_response`,
`roster_assignment`, `published_roster`, `timesheet_entry`, `clock_photo`,
`leave_request`, `shift_offer`, `staff_certification`, `supplier`, `item`,
`stock_check_entry`, `notification`, `staff_notification`. All domain tables
are business-scoped.

Notable columns / conventions:

- `user.email` — unique both case-sensitively (the Auth.js adapter's equality
  lookups) and via `user_email_lower_unique` on `lower(email)` (guard against
  case-variant duplicate accounts; every sign-in path already lowercases, so
  the index can only reject rows the app itself could never create).
- `staff_member.notify_by_default` — pre-checks this person when the owner asks
  for availability. Owners override per-send on the recipient-selection step.
- `staff_member.pin_hash` — salted scrypt hash of the kiosk PIN (`scrypt$salt$hash`).
  `failed_pin_attempts` / `pin_locked_until` back the per-staff brute-force guard
  (5 wrong PINs → 60s cooldown). Helpers (hash, verify, lockout) are pure in
  `src/lib/pin.ts`; the PIN itself is never stored or logged.
- `business.kiosk_token_hash` — SHA-256 hash of the kiosk capability token (only
  the hash is stored; raw token lives in the link/cookie). `require_clock_in_photo`
  toggles kiosk photo capture (off by default). `photo_retention_days` (NOT NULL
  default 7; allowed 7/30/90) is how long clock-in photos are kept before the
  daily retention job purges them — always on, owner picks the number in Settings.
  `latitude`/`longitude` (nullable) + `geofence_radius_m` (NOT NULL default 200;
  owner picks 100/200/500) are the shop location used ONLY to geofence
  personal-phone clock-in (never the kiosk). `personal_clock_token_hash` is the
  SHA-256 hash of the SEPARATE personal-phone clock-in capability token (distinct
  from `kiosk_token_hash`); rotating it revokes old personal links.
- `staff_member.pay_rate_cents` (nullable) + `rate_type` (`flat`/`award`, NOT
  NULL default `flat`) + `rate_label` — a per-employee hourly rate the owner
  typed, stored in cents, with an optional label. A stored number + label only;
  the app never calculates wages. Surfaced on the Staff page and the CSV export.
- `timesheet_entry` — one clock in/out. `clock_out_at` null = currently in; a
  **partial unique index** on `staff_member_id WHERE clock_out_at IS NULL` makes
  double clock-in impossible. `shift_id` links a rostered shift when one matches
  (published + confirmed) on the clock-in's business-local date, else null.
  `approved` is the owner's payroll sign-off (and the filter for the CSV hours
  export). `clock_in_lat`/`clock_in_lng`/`within_geofence` are set only by
  personal-phone GPS clock-in (null for kiosk and owner-entered rows);
  `within_geofence = true` means location-verified. Clock logic is pure in
  `src/lib/clock.ts`; geofence maths in `src/lib/geo.ts`.
- `clock_photo` — optional clock in/out still, stored inline as `bytea`, cascaded
  with its entry. Served only to the owner via `/app/timesheets/photo/[id]`. A
  daily pg-boss cron (03:00 UTC, registered in the worker boot path) sweeps every
  business and deletes photos whose entry's `clock_in_at` is older than that
  business's `photo_retention_days`. It deletes **only** `clock_photo` rows (never
  `timesheet_entry`), is tenant-scoped per business, and is idempotent. Cutoff
  logic is pure in `src/lib/retention.ts`; deletion is `deleteExpiredPhotos` on
  the tenant repo.
- `availability_response` — `request_id` is **nullable**. A response with no
  request is an owner **manual pre-fill** (`source = 'manual'`); it carries
  `staff_member_id` directly (staff replies derive theirs via the request).
  Manual pre-fills create no email and no `availability_request`, and the
  reminder job skips anyone who has one.
- `roster_assignment.status` — `'suggested'` (a draft proposed by "Draft from
  last week") or `'confirmed'`. **Only confirmed assignments are published**
  (`rosterRows` filters to confirmed), so un-accepted suggestions never leak
  into the public roster or staff emails.
- Draft suggestion logic lives in `src/lib/draft.ts` (pure, deterministic — no
  LLM/external calls). It matches by shift type (template, or label+times if the
  template was deleted) **and** weekday, suggesting only available staff who are
  not on approved leave that day (optional `isOnLeave` arg).
- `leave_request` — a staff time-off request and the owner's decision. `status`
  (`pending`/`approved`/`denied`, NOT NULL default `pending`); `leave_type`
  (`annual`/`sick`/`unpaid`/`other`); inclusive `start_date`/`end_date` stored
  as `YYYY-MM-DD` calendar dates (timezone-free, like shift dates); nullable
  `note`; `decided_at` (set on approve/deny); `decision_notified_at` (set after
  the decision email sends, making the job idempotent — mirrors availability
  `sent_at`). Indexed on `business_id`, `staff_member_id`, `status`. Staff
  create `pending` rows via the PIN-gated `submitStaffLeave`; the owner decides
  or records `approved` rows directly on `/app/leave`. On-leave date maths is
  pure in `src/lib/leave.ts`. **Record only — no balances, accruals,
  entitlements or NES/award calculation.**
- `shift_offer` — a confirmed published shift made claimable, and its handover
  lifecycle. `status` (`open`/`claimed`/`approved`/`denied`/`withdrawn`, NOT
  NULL default `open`); `offered_by_staff_id` (nullable — the releaser, NULL
  when the owner posted an open shift); `claimed_by_staff_id` (nullable);
  `decided_at`; `decision_notified_at` (approval-email idempotency). Indexed on
  `business_id`, `shift_id`, `status`, with a **partial unique index on
  `shift_id WHERE status IN ('open','claimed')`** so a shift has at most one
  active offer. Releasing never alters the releaser's `roster_assignment`;
  `approveOffer` transfers atomically (assign claimer confirmed, remove the
  releaser). Transition + eligibility logic is pure in `src/lib/shift-offer.ts`;
  staff PIN-gated release/claim/cancel cores are in
  `src/lib/shift-offer-submission.ts`; the owner manages it on `/app/shifts`.
  **One-directional only — no bilateral A↔B swaps, no auto-approval, published
  rosters only.**
- `staff_certification` — a qualification tracked for expiry. `cert_type`
  (`rsa`/`rsg`/`food_safety`/`first_aid`/`wwcc`/`other`); nullable `cert_label`
  (required by the UI for `other`) and `reference_number`; NOT-NULL
  `expiry_date` (calendar date); `last_reminder_stage`
  (`early`/`final`/`expired`, nullable — the reminder idempotency cursor, reset
  to null when `expiry_date` changes). Indexed on `business_id`,
  `staff_member_id`, `expiry_date`. `business.cert_reminder_lead_days` (NOT NULL
  default 30; owner picks 30/60/90) is how many days before expiry the first
  reminder fires. **Text + dates only — no documents; flagged/reminded, never
  enforced.** Pure status/stage maths in `src/lib/certification.ts`; the daily
  `cert-reminder` job emails the owner (see Key product decisions).
- `supplier` — a supplier the business orders stock from (inventory). NOT-NULL
  `name`; nullable `contact_name`/`email`/`phone`/`notes`; `delivery_days`
  (`integer[]`, NOT NULL default `{}`, **ISO 1–7** like `shift_template.weekdays`);
  `order_cutoff_days_before` (integer, NOT NULL default 1 — "order by X days
  before delivery", used by the Part 2 reminder job); `last_order_reminder_date`
  (date, nullable — the order-reminder idempotency cursor: the delivery date last
  reminded for, set after a successful send). Indexed on `business_id`. **The app
  never places orders or integrates with any supplier system.**
- `item` — an inventory item / SKU (inventory; tracking only). NOT-NULL `name`;
  nullable free-text `sku_code`/`unit`; nullable `supplier_id` → `supplier` **(set
  null on delete** — the item is kept, just unlinked); `is_active` (NOT NULL
  default true — retire without deleting). Indexed on `business_id` and
  `(business_id, supplier_id)`. CSV import parses/validates in
  `src/lib/item-import.ts` (pure) and writes via `bulkInsertItems`; supplier
  matching is case-insensitive by name, dedupe is by name-or-sku (see Key product
  decisions).
- `stock_check_entry` — one stock check on one item (inventory Part 2; tracking +
  reminders only). NOT-NULL `item_id` → `item` (cascade); `status`
  (`available`/`low`/`needs_order`); nullable free-text `quantity` (record-only,
  never parsed); `checked_by_staff_id` → `staff_member` **(set null** — NULL means
  the OWNER set it, and a deleted staff member's history rows null out);
  NOT-NULL `checked_at`. Indexed on `(business_id, item_id)` and
  `(business_id, checked_at)`. An item's CURRENT status is its latest entry
  (`itemsWithCurrentStatus`, DISTINCT ON). Pure order-by/selection logic in
  `src/lib/order-reminder.ts`; staff PIN-gated core in
  `src/lib/stock-check-submission.ts`; the owner manages it on `/app/stock` and
  the daily `order-reminder` job emails the owner (see Key product decisions).
  **Flagged/reminders only — never enforced; the app never places orders.**
- `notification` — an owner-facing in-app notification (the header bell). NOT-NULL
  `type` (`notification_type`: `leave_requested`/`shift_offer_activity`/
  `stock_needs_order`/`cert_expiring`/`availability_reply`), NOT-NULL `title`,
  nullable `body`/`link_path` (where clicking it goes, e.g. `/app/leave`),
  `is_read` (NOT NULL default false), `created_at`. Indexed on
  `(business_id, is_read)` and `(business_id, created_at)`. Created best-effort
  and **preference-gated** via `notifyOwner` (`src/lib/notifications.ts`) at each
  event source; **IN ADDITION to the existing emails**. Per-event preferences are
  five `notify_*` boolean columns on `business` (all NOT NULL default true).
  **Owner only — the staff analog is `staff_notification` below.**
- `staff_notification` — a STAFF-facing in-app notice, keyed to ONE staff
  member (`staff_member_id`, cascade) and shown only on their PIN-gated `/me`
  page. NOT-NULL `type` (`staff_notification_type`: `leave_decided`/
  `shift_swap_approved`/`rostered`/`shift_reminder`), NOT-NULL `title`,
  nullable `body`, `is_read` (NOT NULL default false), nullable `dedupe_key`
  (**unique index** — the daily shift reminder's idempotency:
  `shift_reminder:<staffId>:<date>` inserted ON CONFLICT DO NOTHING; event
  notices leave it NULL), `created_at`. Indexed on
  `(staff_member_id, is_read)` and `(business_id, created_at)`. Created
  best-effort via `notifyStaff` (`src/lib/staff-notifications.ts`) at the
  event sources, or directly (NOT best-effort) by the `staff-shift-reminder`
  job. **IN ADDITION to the existing staff emails — never a replacement.**
  Related columns: `staff_member.notices_token_hash` (nullable, unique — the
  SHA-256 hash of that person's `/me` capability token; rotate to revoke) and
  `business.staff_shift_reminders_enabled` (NOT NULL default true — the
  business-level toggle for the daily in-app reminder).

## Milestones

- [x] M1 — Scaffold, tooling, CI
- [x] M2 — DB schema, migrations, tenant layer, seed
- [x] M3 — Owner auth + business creation
- [x] M4 — Staff + shift templates + roster periods
- [x] M5 — Availability requests + staff magic-link flow
- [x] M6 — Availability summary + roster builder
- [x] M7 — Publish + reminders (jobs)
- [x] M8 — Accessibility + polish
- [x] M9 — Clock-in kiosk + timesheets (PINs, brute-force guard, optional photos)
- [x] M10 — Leave requests + owner approvals (PIN submission, decision emails, roster flagging)
- [x] M11 — Shift swaps / open shifts (release → claim → owner-approved transfer, notifications)
- [x] M12 — Certification tracking + daily expiry reminders (owner-managed, flagged not enforced)
- [x] M13 — Inventory foundations Part 1: items (SKUs) + CSV import, suppliers with delivery days (tracking only; stock checks + order reminders are Part 2)
- [x] M14 — Inventory Part 2: staff stock checks (PIN, both clock surfaces) + owner Stock view + daily order reminders (flagged/reminders only; never places orders)
- [x] M15 — Hours & labour-cost reporting: owner report page (`/app/reports`) + dashboard summary, read-only over existing timesheets/rates (estimate only — no payroll/award calculation; no schema change)
- [x] M16 — Owner in-app notifications: header bell (unread count + dropdown) + `/app/notifications` + per-event preferences, fed best-effort from the five existing events (owner only; emails unchanged; no realtime)
- [x] M17 — Owner getting-started checklist on the dashboard: step state derived from existing data (no manual ticking), core steps gate visibility (auto-hides when all four are done; optional inventory steps never keep it alive); read-only, no schema change
- [x] M18 — Staff in-app notices: per-staff PIN-gated `/me` page (capability link + short-lived signed proof), notices at leave decisions / swap approvals / publishes (additive to emails), and a daily IN-APP-ONLY shift reminder (idempotent via dedupe key; business-level toggle)
