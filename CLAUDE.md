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
estimate), **MYOB API integration** (file export only) and any **payroll
CALCULATION via API** — note a **Xero DRAFT-timesheet push** was later added at
the owner's request (M27; draft timesheets only, no pay-run/wage calculation —
see "Xero Payroll AU" under Key product decisions), so "no payroll API" now means
no pay-run/wage-calc API, not no API at all (M28's owner-authored pay rules
likewise only sort hours between the owner's OWN Xero pay items — Roster still
stores no rate/multiplier and calculates no pay),
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
continuous/background location tracking, and — for the Google Drive document
feature (Phase 1, built) — **OneDrive, Dropbox, and per-employee
onboarding/offboarding checklists** (those are later, separate phases), any
**broader-than-`drive.file` Drive access**, using the Google connection as a
**login method**, and **storing file bytes in the app's own DB/storage** (Drive
is the home; the app holds only a reference). If a request drifts here, flag it
rather than silently building it.

Note: clock-in/timesheets was added after the original MVP (time clocking used
to be listed out of scope) at the owner's explicit request. It captures hours +
owner approval, not payroll export.

Note: **multi-location** (M29) was added after the original MVP (which assumed
one owner = one business = one tenant) at the owner's explicit request. One owner
now runs several **locations** under one **organisation**, and staff are a shared
org-wide pool that can be placed/lent across locations. See "Multi-location" under
Key product decisions and the org invariants under Non-negotiable conventions →
Multi-tenancy. Per-location tenancy is UNCHANGED for all work records — only the
staff roster became org-level. Still out of scope: cross-**org** anything,
bilateral auto-swaps, and multi-owner org governance beyond a single `owner` role.

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
- Cloudflare Turnstile — bot protection on the public form route (verified
  server-side via `src/lib/turnstile.ts`); `qrcode` — server-side QR generation
  for public form links

## Key product decisions

- **Multi-location (M29, Strategy A — Phases 0–2 built)**: one owner runs several
  **locations** under one **organisation**, with a shared org-wide staff pool.
  Plan + phase status: `docs/multi-location-plan.md`.
  - **`organisation`** is the account boundary; each **`business` = a location**
    and carries `org_id`. An owner reaches an org via **`org_membership`** (v1
    role `owner` only). The table is still called `business`; "location" is a
    UI/doc name only.
  - **Staff collapsed to the org (Strategy A)**: a **`staff_member` is org-level**
    (one row per person, `org_id` set) and reaches a location through
    **`staff_location`** (membership). `staff_member.business_id` is kept as the
    person's **home** location through the transition. **Only the staff roster is
    org-level — every WORK record (rosters, assignments, timesheets, availability,
    leave, certs, stock, inventory, forms, Xero) stays scoped to its own
    `business_id`, unchanged.**
  - **The tenant repo's staff scoping is membership-based**: a person is
    visible/actionable at a location when their **home is there OR they hold an
    active `staff_location`** (the `memberHere` predicate in
    `createTenantRepo`). So placing a person at a location (a membership) makes
    them appear in that location's roster builder / availability / kiosk — this
    is how staff are **shared and lent** across locations. `addStaff` creates the
    org-level row + a home membership atomically.
  - **Active location**: `requireOwner()` resolves `orgId` from membership and a
    **validated** active `businessId` (a cookie honoured only if it belongs to
    the org — N2). Every existing owner page tenants through the active location,
    so the header **location switcher** re-scopes them all with no per-page
    change. `ownerRepo()` = active-location tenant repo; `orgRepo()` /
    `createOrgRepo(orgId)` = org-scoped (locations + the People pool);
    `ownerContext()` returns both.
  - **Owner surfaces**: `/app/locations` (list/switch/add locations, org-scoped)
    and `/app/people` (the shared pool — everyone org-wide + per-location
    membership chips). New people are still added on a location's `/app/staff`.
  - **Follow-ups (NOT built)**: staff-INITIATED cross-location shift cover
    (org-scoped `shift_offer` claimable from another location's kiosk — the
    owner-driven version already works via People + the roster builder) and
    date-ranged `staff_loan` records. See the plan doc §7.
- **Shifts**: business defines reusable **shift templates** (label + start/end +
  weekday flags + an optional owner-chosen **colour**). Creating a roster period
  expands templates into concrete shifts per day. Owners can **edit** a type
  (name/times/days/colour) and **delete** one on `/app/templates`; deleting is
  non-destructive to past rosters — `shift.template_id` is ON DELETE SET NULL,
  so concrete shifts keep their label/time snapshot and just unlink.
- **Availability**: per-shift yes/no (Available / Not available). 1:1 mapping to
  assignments.
- **Owner auth**: email magic link. First sign-in creates the Business.
- **Inbound SSO from prompt2eat** (`POST /api/sso/prompt2eat`): a sister app
  (prompt2eat) hands the owner a signed, single-use token so they open Roster
  without a second sign-in. **Identity stores stay separate** (email-level
  linking only — no shared cookie, user table or secret). prompt2eat holds the
  Ed25519 PRIVATE key; Roster holds only the PUBLIC key
  (`PROMPT2EAT_SSO_PUBLIC_KEY`, optional → the verify path FAILS CLOSED when
  unset), so Roster can verify a handoff but never mint one. The token is a
  compact EdDSA JWS delivered in a cross-origin POST **body** (never a URL/log).
  The route verifies signature + `iss`/`aud`/`alg` + `exp`/`iat` (≤30s skew,
  ≤60s lifetime), enforces single use via `jti` in `sso_consumed_tokens`
  (`onConflictDoNothing`, GC'd after ~10 min), **matches-or-provisions the owner
  by verified email** in Roster's OWN `user` table (case-insensitive), mints
  Roster's OWN Auth.js **database** session (a `session` row + the
  `authjs.session-token` cookie), and **303-redirects to a fixed `/app`** (no
  redirect param → no open-redirect). Any failure → `/sign-in?error=sso` with a
  generic message (never echoes token contents). `venue` is CONTEXT ONLY (never
  an org key); `entitlements.roster` is available for onboarding but tenancy
  stays Roster's concern. Pure verify logic in `src/lib/sso/roster-sso.ts`,
  replay guard in `src/lib/sso/replay.ts`, programmatic sign-in in
  `src/lib/auth/sso-session.ts`. Full contract: `docs/roster-sso-contract.md`.
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
  - **Shared CSV serializer** (`src/lib/timesheet-export.ts`): `csvCell`
    (RFC-4180 escaping), `sanitizeCsvValue` (prefix a leading `= + - @`/tab/CR
    with `'` to stop spreadsheet **formula injection**), and `csvField =
csvCell(sanitizeCsvValue(v))` — guard the raw value first, THEN escape. ALL
    CSV exports (approved hours, staff rates, form responses) go through
    `csvField`; treat every value as hostile (names, imported item names and
    anonymous public form answers can all start with a dangerous char).
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
  - **Six event types** (`notification_type`): `leave_requested`,
    `shift_offer_activity` (released or claimed), `stock_needs_order`,
    `cert_expiring`, `availability_reply`, and `form_response` (Phase 3a — the
    only COALESCED type; see below). The set is fixed.
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
    unchanged**, only the extra in-app row is pref-gated). **`form_response`**
    (Phase 3a) is created by `notifyFormResponse(repo, {formId, formTitle})` from
    the two form-submission cores AFTER the response commits, best-effort —
    fired ONLY on a genuine new-response success (never on a honeypot drop,
    rate-limit/Turnstile/validation reject, store-null, or an `already_responded`
    blocked-duplicate, which stores nothing).
  - **New-response notifications COALESCE** (Phase 3a — a busy public form would
    otherwise flood the bell): ONE updating UNREAD row per form. `notification`
    gains `group_key` (`form_response:<formId>`, NULL for every other type) +
    `count`; a new response increments the form's existing unread row (count+1,
    title refreshed, `created_at` bumped to resurface it) or starts a fresh one.
    The **partial unique index** `(business_id, group_key) WHERE group_key IS NOT
NULL AND is_read = false` is the upsert's ON CONFLICT arbiter, so a flood is
    race-safe and the bell shows ONE item (count N), not N. Reading the row (the
    bell marks it read on navigate) flips `is_read`, so the next response starts
    a fresh count. **PRIVACY: count + form title + link ONLY** — never answer
    content and never a respondent identity, so the wording is IDENTICAL for
    public, attributed and anonymous responses (an anonymous internal response
    can never imply who submitted). Email (a daily digest) is deferred to a later
    phase; this phase is in-app bell only.
  - **Preferences are six boolean columns on `business`** (`notify_*`, all
    default true, incl. `notify_form_response`) — a fixed event set makes columns
    simpler than a side table (no row-existence/default ambiguity). Toggled in
    Settings via a tenant-scoped action (the UI auto-renders from
    `NOTIFICATION_TYPES`).
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
- **Google Drive document storage (Phase 1 of a phased feature)**: an owner
  connects their OWN Google Drive and uploads documents (contracts, RSA, ID)
  that are stored in THEIR Drive and attached to a staff member. **The app
  stores only a REFERENCE (Drive file id + web link) — never the file bytes, in
  the DB or anywhere else, and never logs file content.** Later phases (OneDrive,
  Dropbox, per-employee onboarding/offboarding checklists) are **separate, not
  built here**.
  - **Separate from sign-in.** The owner's Auth.js email-magic-link login is
    UNTOUCHED. The Google connection is an ADDITIONAL OAuth authorization the
    owner grants so the app can store files in their Drive — it is NOT a login
    method and must never become one.
  - **`drive.file` scope ONLY** (`https://www.googleapis.com/auth/drive.file`):
    the app can only see/manage files IT creates, never the owner's other Drive
    files. No broader Drive scope is ever requested. The connected Google account
    email (display only) is read via Drive's `about.get` (works under drive.file)
    — we do NOT add `email`/`openid` scopes.
  - **OAuth flow** (owner-session-gated, per business): `GET
/api/integrations/google/connect` mints a CSRF `state` nonce (short-lived
    httpOnly cookie) and redirects to Google's consent (`access_type=offline` +
    `prompt=consent` so a refresh token is always returned). The callback
    (`/api/integrations/google/callback`) derives `businessId` from the OWNER
    SESSION (never from `state`/query), verifies the state cookie, exchanges the
    code, stores tokens, records the email and creates a per-business "Roster
    Documents" Drive folder (reused on reconnect). Every failure redirects to
    Settings with a friendly message — it never crashes. The client (Settings
    card) offers Connect / Reconnect (on `needs_reconnect`) / Disconnect.
  - **Tokens are encrypted at rest with AES-256-GCM** (`src/lib/crypto.ts`;
    versioned `v1.<iv>.<tag>.<ciphertext>`, fresh 96-bit IV, auth-tag verified on
    decrypt) keyed by `TOKEN_ENCRYPTION_KEY` (base64 of 32 bytes). The app
    otherwise only HASHES secrets, so this reversible mechanism was added for
    this feature. **FAIL CLOSED**: `isDriveConfigured()` gates the connect flow
    on the OAuth env vars AND a valid key, so a token is NEVER stored in
    plaintext; tokens are decrypted only server-side, immediately before a Drive
    call, and are never returned to the client or logged.
  - **Token refresh / revocation** (`src/lib/google-drive/service.ts`):
    `ensureFreshAccessToken` refreshes when `isTokenExpired` (60s skew) and
    persists the new encrypted access token before any Drive call. A
    revoked/`invalid_grant` refresh sets `google_drive_connection.needs_reconnect`
    and throws the typed `DriveReconnectRequired`; the UI surfaces a "reconnect
    Google Drive" prompt — it never crashes the request.
  - **Disconnect ≠ delete.** Disconnecting best-effort revokes the grant and
    forgets the stored tokens (stops further uploads); it does NOT delete files
    already in the owner's Drive — they're the owner's. The UI says so.
  - **Upload-through-server** (Staff page, per staff member): a multipart server
    action validates size (≤ **10 MB**) + an allow-list of common doc/image mime
    types (`validateUpload`, pure) BEFORE any Drive call, confirms the staff
    member is this business's, then streams the bytes into the business's Drive
    folder and stores a `staff_document` row with the returned Drive file id +
    web link. The next-config `serverActions.bodySizeLimit` is raised to 12 MB.
    No upload control is shown unless a usable connection exists (else a "Connect
    Google Drive first" prompt).
  - **View / delete**: per staff member the card lists documents (name → Drive
    link, type, date). **Delete removes the app's reference AND deletes the file
    the app created in Drive** (the app created it), best-effort — a
    reconnect-needed/Drive error still removes our reference so no dangling row
    remains. The UI states the Drive file is removed too.
  - **The Drive client is server-side only and mockable**: a `DriveClient`
    interface (`src/lib/google-drive/client.ts`) wraps the OAuth + Drive v3 REST
    calls (google-auth-library for token exchange/refresh, `fetch` for folder/
    upload/delete/about/revoke) so the whole flow is unit-tested against a fake
    Drive (`tests/google-drive-flow.test.ts`). Pure helpers
    (`isTokenExpired`, `buildGoogleAuthUrl`, `validateUpload`, the AES helpers)
    are unit-tested in `tests/google-drive-helpers.test.ts` + `tests/crypto.test.ts`.
- **Xero Payroll AU (M27)**: owners push **approved, closed** hours to Xero as
  **DRAFT timesheets** for a human to approve + run pay on inside Xero. **HARD
  BOUNDARY — Roster never calculates or processes pay**: the integration only
  ever creates/updates/deletes DRAFT timesheets; there is **NO code path** to a
  Xero pay run, to approving/reverting a timesheet, or to writing employee bank/
  tax/super details, and `payroll.payruns` is never requested. Full plan +
  decision history: `docs/xero-payroll-integration-plan.md`.
  - **Uses AU Payroll 2.0 for timesheets** (`payroll.xro/2.0`): ISO
    `YYYY-MM-DD` dates, explicit `payrollCalendarID`, one line **per day** with a
    scalar `numberOfUnits`, title-case `"Draft"` status, a `{ timesheet }`
    response envelope, and a **real `DELETE`**. Verified from Xero's generated 2.0
    SDK models. (An earlier 1.0 attempt was reversed once the owner confirmed —
    via a dated Xero changelog — that AU 2.0 timesheets exist; history is in the
    plan doc.) **Two isolated live-verify constants** in `src/lib/xero/tokens.ts`
    (`XERO_TIMESHEET_BASE_PATH`, `XERO_TIMESHEET_SCOPE`) are the ONLY details not
    confirmable from the docs (they 403 automated fetch) — lock them at the first
    live AU demo-company connect (README "Xero — live-verify checklist").
  - **Narrow, mockable client** (`src/lib/xero/client.ts`): raw `fetch` (NOT the
    `xero-node` SDK, so the boundary is structural — the forbidden methods simply
    don't exist). Exposes OAuth + `getConnections` + read-only
    `listEmployees`/`listEarningsRates`/`getEmployeePayTemplateEarnings`/
    `getPayrollCalendar` + `createDraftTimesheet` (status hard-coded `"Draft"`,
    the input has no status field) + `getTimesheet` + `deleteTimesheet`. A guard
    test (`tests/xero-client-flow.test.ts`) pins the EXACT method set — no
    approve/revert/pay-run/employee-write. `service.ts` mirrors the Drive service
    (`completeXeroConnection`, `ensureFreshXeroAccessToken` — Xero rotates the
    refresh token, so BOTH tokens are persisted on refresh; `invalid_grant` →
    `needs_reconnect`). Tokens reuse `crypto.ts` (AES-256-GCM, shared
    `TOKEN_ENCRYPTION_KEY`), fail-closed via `isXeroConfigured()`.
  - **Connection is `pending_confirmation` until the owner confirms the org
    name** (the link-interception catch): stored inactive on every (re)connect;
    `confirmXeroConnection` activates ONLY when the owner confirms the exact
    tenant id shown; a push is refused unless `active`. Connect works two ways —
    the owner's own OAuth, or a **delegated single-use bookkeeper invite**
    (`xero_connect_invite`): the raw token rides through OAuth in an httpOnly
    cookie and is consumed by a **single atomic `UPDATE … WHERE consumed_at IS
NULL AND revoked_at IS NULL AND expires_at > now RETURNING`** in the callback
    (cross-tenant `consumeXeroConnectInvite`; single-use, revoke/expiry-safe,
    race-safe), so a mail-client prefetch can't burn it.
  - **Mapping + earnings rate** (`resolve.ts`, pure): each active staff → a Xero
    employee; the ordinary earnings rate is the employee's pay-template
    `RegularEarnings` line, else the org's sole `RegularEarnings` rate, else
    UNRESOLVED (owner picks; blocked from push until then). Owner-editable. The
    pay **period** comes straight from the employee's Xero calendar
    (`periodStartDate`/`periodEndDate`) — **no local period math** (a wrong
    period fails silently, so it is never computed).
  - **Push / re-push / cancel** (`push.ts`): eligible = `approved`, closed
    entries for mapped staff with a resolved rate. Aggregation was
    (`timesheet-lines.ts`, pure) → per-business-local-day lines (2dp, matching the
    CSV/report) under a single ordinary rate; since M28 the push classifies via
    `pay-rules.ts` (below) — zero rules reproduces the single-rate output
    line-for-line. Re-push on 2.0 = **delete-then-
    create** (no update verb), holding one INVARIANT: **`xero_timesheet_id` is
    non-null ⟺ a live Draft exists** — the id is set to NULL the instant a delete
    succeeds (before the recreate), so a failed/crashed recreate leaves a DISTINCT
    `{status: failed, id: NULL}` "no draft currently exists" state, never a
    pointer to a deleted id. The **Idempotency-Key varies per create attempt**
    (`base + ":attempt=" + attempt`, `attempt` bumped each cycle, migration 0020)
    so a post-delete replay can't return Xero's cached deleted-timesheet response;
    the durable `UNIQUE (business, staff, period_start, period_end)` push row is
    the long-window de-dupe guard. Cancel guards still-`Draft` (typed
    `XeroTimesheetAlreadyActioned`) → real `DELETE` → `cancelled` + null id. Every
    surface states that Roster classifies no rates itself — the owner's rules
    (M28) sort hours between THEIR pay items, and the human runs pay in Xero.
  - **Owner UI**: Settings → Xero card (connect / invite bookkeeper /
    confirm-org / reconnect / disconnect), `/app/xero` (staff mapping),
    `/app/xero/push` (per-employee preview + push + cancel, reached from a
    Timesheets entry card), `/app/xero/rules` (M28 pay rules — next bullet).
    All against the shared `ui.tsx` kit + Roster tokens.
    The public bookkeeper landing is `/xero/connected`.
- **Pay-classification rules (M28)**: OWNER-AUTHORED mechanical rules that sort
  pushed hours onto the owner's OWN Xero pay items, splitting a shift into
  multiple draft-timesheet lines (per-line `earningsRateID` — the 2.0 wire
  format already carried it per line; only the input type widened, the client
  METHOD SET is untouched). **HARD BOUNDARY: Roster ships ZERO built-in award
  rules, ZERO default percentages, ZERO award names in code/config/UI; the
  `pay_rule` table ships EMPTY and stores NO dollar figure and NO multiplier**
  — only a condition + a pay-item REFERENCE (id + display-name snapshot). Every
  dollar comes from the pay item's setup in Xero; everything still lands as a
  Draft a human approves there. Guard tests (`tests/pay-rules-boundary.test.ts`)
  pin the exact column set (nothing that could hold pay maths), that the
  migration INSERTs nothing, and that the engine/UI contain no award/preset
  vocabulary.
  - **Five condition types** (`pay_rule_condition_type`): `day_of_week` (ISO
    1–7), `time_of_day_after`/`time_of_day_before` (`HH:MM` business-local wall
    clock), `daily_hours_beyond`/`weekly_hours_beyond` (cumulative worked
    hours). The jsonb `condition_config` is zod-validated per type
    (`payRuleConditionConfigSchemas`); the type lives in the enum column, not
    the json.
  - **Evaluation is pure + deterministic, server-side over stored clock data**
    (`classifyEntries` in `src/lib/xero/pay-rules.ts`; never client input):
    each entry splits into atomic sub-blocks at local midnights, time-of-day
    cutoffs and threshold-crossing instants; each sub-block matches ACTIVE
    rules in the owner's explicit `priority` order — **first match wins;
    precedence is the owner-visible, reorderable list** (never a silent pick);
    unmatched hours stay on the employee's ordinary rate. Conditions read each
    worked MOMENT's own local wall clock (a Fri 20:00→Sat 02:00 shift has 2
    Saturday hours) while line DATES keep the M27 bucketing (the clock-in's
    local date, matching CSV/report). Weekly cumulation spans the business-
    local Monday-start week — the push/preview fetch entries back to that
    Monday purely as counter context (context entries emit no lines). Per-day
    2dp totals reconcile exactly with the M27/CSV/report day total (remainder
    absorbed into the largest line), so **zero rules ⇒ output identical to
    `buildTimesheetLines`** (tested).
  - **Rule changes re-push naturally**: `hashPushPayload` covers each line's
    pay item, so an edited rule changes the hash and the next push replaces the
    draft through the existing delete-then-create path (same invariant, same
    per-attempt key). A rule pointing at a pay item deleted from Xero **blocks
    the push with a named, fixable error** (and is badged "Missing in Xero" on
    the rules page) — never a silent skip or a raw Xero 400.
  - **Owner UI**: `/app/xero/rules` — the ordered list IS the precedence
    (add/edit form with pay items from live `listEarningsRates`, on/off toggle,
    move up/down, delete; pay-item name snapshot re-read from Xero server-side,
    never the form). The `/app/xero/push` preview expands per employee to the
    full per-shift breakdown (segments → matching rule → pay item) — the human
    checkpoint before anything is sent.

## Non-negotiable conventions

### Multi-tenancy

- Every domain row carries `business_id`.
- `business_id` is ALWAYS derived from the authenticated session (owner) or a
  validated scoped token (staff). **Never** trust a client-supplied
  `business_id` from body/query/params.
- All domain reads/writes go through the tenant-scoped data-access layer in
  `src/lib/tenant/`. Don't query domain tables directly from routes.
- **Org layer (M29)** — a `business` is now one **location** under an
  **`organisation`**; staff are org-level (see Multi-location under Key product
  decisions). Additional invariants (`docs/multi-location-plan.md` §5):
  - **N1** — the owner's `orgId` comes from `org_membership` (server-side), never
    request input. `requireOwner()` resolves it.
  - **N2** — the **active location** must belong to the owner's org. The
    active-location cookie is honoured only after `locationBelongsToOrg`
    validates it; a forged/stale id silently falls back. `createOrgRepo` /
    `ownerContext` gate every org-level read/write.
  - **N3** — any cross-location or org-level write (`addPersonToLocation`,
    future `approveOrgOffer`/lend) must verify **both** the person AND the
    location belong to the acting owner's org before mutating. A location can
    never see or borrow another org's staff.
  - **N4** — staff surfaces (`/clock`, `/kiosk`, `/me`) still resolve their
    location from a per-location capability token; a kiosk only lists/acts on
    that location's **members** (the `memberHere` predicate). There is no
    org-wide staff session.
  - **N5** — `createTenantRepo(businessId)` is unchanged and still the only path
    to per-location domain rows; `createOrgRepo(orgId)` only touches org-scoped
    tables (`organisation`, `org_membership`, org `staff_member`s,
    `staff_location`).

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
- **Type system**: **Archivo** (headings, page titles, badges, numbers — exposed
  as `--font-display` and applied to `h1/h2/h3` globally + the `.font-archivo`
  utility) and **Public Sans** (body/UI — `--font-sans`, the body default).
  Both plus **Material Symbols Rounded** (icons, `.material-symbols-rounded`)
  load via `<link>` in `src/app/layout.tsx` (not `next/font`, to keep builds
  offline-safe). Design tokens live in `src/app/globals.css` `@theme` (colours,
  semantic states, `--shift-*` colours, `--radius-*`, `--shadow-*`); the
  originals (`--color-ink`/`--color-brand`/`--color-button`/header tokens, etc.)
  are kept alongside the refined names since they're referenced app-wide.
  **`--color-brand` (blue) is reserved for links, focus rings and info banners;
  only PRIMARY buttons use the Zaleit green (`--color-button`/`--color-accent`).**
  Shared primitives (`Button`/`Card`/`PageHeader`/`Banner`/`Badge`) are in
  `src/components/ui.tsx`. Three keyframes (`rosterFade`/`rosterPulse`/
  `rosterToast`) are used sparingly — dropdowns, the bell badge, and toasts only.
- **Shift-type colours**: the owner can pick an explicit colour from a fixed,
  accessible `SHIFT_PALETTE` (stored as the bar hex on `shift_template.color`);
  the PURE `resolveShiftColors(color, label)` in `src/lib/shift-colors.ts` uses
  it when set and otherwise falls back to the keyword-derived `shiftColorScheme(name)`
  (morning/arvo/close/split/default → `{bg,bar,text}`), so existing types look
  unchanged. Unit-tested in `tests/shift-colors.test.ts`. The chosen colour flows
  everywhere a shift type shows — the Shift types page, the roster builder, the
  public roster (`/r`, via `color` on `rosterRows`) and availability (`/a`) — by
  resolving each concrete shift's colour from its originating template
  (`templateId`), so a deleted type falls back to the keyword scheme.
- **Owner-area header/nav** (`src/app/app/layout.tsx` + `src/components/OwnerNav.tsx`):
  a Zaleit-branded **dark header** (`--color-header-bg`, green `--color-accent`
  `#76b900` wordmark — header only, content stays white) with the nav grouped into
  four top-level items: **Rosters** (Rosters/`/app/periods`, Shift types/`/app/templates`,
  Shifts/`/app/shifts`, Timesheets/`/app/timesheets`, Reports/`/app/reports`), **Team** (Staff, Leave,
  Certifications), **Orders** (Stock levels/`/app/stock`, Items, Suppliers), and
  standalone **Forms** (`/app/forms`) and **Settings**. The header also carries a **notification bell**
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

`organisation` (M29 account boundary), `org_membership` (owner↔org),
`business` (= a location, carries `org_id`), `staff_location` (M29 org
staff↔location membership), `user` (owner) + Auth.js tables, `staff_member`
(org-level since M29, carries `org_id`), `shift_template`,
`roster_period`, `shift`, `availability_request`, `availability_response`,
`roster_assignment`, `published_roster`, `timesheet_entry`, `clock_photo`,
`leave_request`, `shift_offer`, `staff_certification`, `supplier`, `item`,
`stock_check_entry`, `notification`, `staff_notification`, `form`, `form_field`,
`google_drive_connection`, `staff_document`, `xero_connection`,
`xero_employee_map`, `xero_timesheet_push`, `xero_connect_invite`, `pay_rule`.
Work-record domain tables are business-scoped; `staff_member` is org-scoped
(reached per location via `staff_location`); `organisation`/`org_membership`/
`staff_location` are org-scoped. Plus one non-tenant infrastructure table:
`sso_consumed_tokens` (the inbound prompt2eat SSO replay guard — no `business_id`,
like the Auth.js `session`/`verificationToken` tables).

Notable columns / conventions:

- `user.email` — unique both case-sensitively (the Auth.js adapter's equality
  lookups) and via `user_email_lower_unique` on `lower(email)` (guard against
  case-variant duplicate accounts; every sign-in path already lowercases, so
  the index can only reject rows the app itself could never create).
- `organisation` (M29) — the account boundary. `name`, `default_timezone`
  (seeds a new location's tz). Onboarding creates one per new owner; the M29
  backfill created one per pre-existing business (**reusing the business id as
  the org id** for a linkable 1:1 — see `drizzle/0023` + the mirrored, tested
  `backfillOrgs` in `src/lib/tenant/org-backfill.ts`).
- `org_membership` (M29) — which owners can reach which org. `org_id` (cascade),
  `user_id` → `user` (cascade), `role` (`org_role`, v1 `owner` only), unique
  `(org_id, user_id)`. The source of "what can this signed-in owner reach",
  resolved in `requireOwner` via `resolveOrgForUser`.
- `business.org_id` (M29, nullable during rollout, backfilled) — the location's
  organisation. Every location keeps ALL its own work-record scoping unchanged.
- `staff_member.org_id` (M29, nullable during rollout, backfilled) — the person's
  organisation; the staff row is now org-level. `business_id` is retained as the
  person's **home** location (an implicit membership). Pay rate + PIN + lockout
  live on this one org-level row (**one PIN, one rate, org-wide**).
- `staff_location` (M29) — org staff↔location membership. `org_id` (cascade),
  `business_id` → `business` (cascade), `staff_member_id` → `staff_member`
  (cascade), `active`, unique `(business_id, staff_member_id)`. A person appears
  at a location when their home is there OR they hold an active row here (the
  `memberHere` predicate in `createTenantRepo`). Written by `addStaff` (home) and
  the org People page (`addPersonToLocation`/`removePersonFromLocation`, which
  guard the home location and verify both ids share the org — N3).
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
  `stock_needs_order`/`cert_expiring`/`availability_reply`/`form_response`),
  NOT-NULL `title`, nullable `body`/`link_path` (where clicking it goes, e.g.
  `/app/leave`), `is_read` (NOT NULL default false), `created_at`. **Coalescing
  (Phase 3a)**: nullable `group_key` (`form_response:<formId>`; NULL for every
  non-coalesced type) + `count` (NOT NULL default 1) let new-response
  notifications collapse into ONE updating unread row per form — a **partial
  unique index** `(business_id, group_key) WHERE group_key IS NOT NULL AND
is_read = false` is the `upsertFormResponseNotification` ON CONFLICT arbiter
  (race-safe under a flood), and reading the row resets the window. Also indexed
  on `(business_id, is_read)` and `(business_id, created_at)`. Created best-effort
  and **preference-gated** via `notifyOwner` (and `notifyFormResponse` for the
  coalesced type) in `src/lib/notifications.ts` at each event source; **IN
  ADDITION to the existing emails**, carrying COUNT + title + link only (never
  answer content or respondent identity). Per-event preferences are six
  `notify_*` boolean columns on `business` (all NOT NULL default true, incl.
  `notify_form_response`). **Owner only — the staff analog is
  `staff_notification` below.**
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
- `form` — an owner-authored custom form. NOT-NULL `title`; nullable
  `description`; `status` (`form_status`: `draft`/`published`/`closed`, NOT NULL
  default `draft`); `public_slug` (nullable, **unique** — the public URL handle);
  `allow_anonymous` (NOT NULL default false — **Phase 2**: whether STAFF
  responses are anonymous; frozen once the form has its first internal response);
  `internal_enabled` (NOT NULL default false — **Phase 2**: whether staff can
  fill this form in their `/me` portal, INDEPENDENT of the public publish state);
  `created_at`/`updated_at`. Indexed on `business_id`. **Phase 1b**
  writes `status` + `public_slug`: `publishForm` sets `published` and generates
  an unguessable slug (`generateSlug`, 16-char base64url) ONLY if absent —
  idempotent, so re-publishing or re-opening a closed form keeps the slug (and
  printed QR codes); `closeForm` sets `closed` (keeps the slug) and the public
  route then refuses responses. Postgres allows many NULL slugs under the unique
  constraint (drafts never collide).
- `form_field` — one owner-labelled field on a `form` (form builder, Phase 1a).
  NOT-NULL `form_id` → `form` (**cascade**); `business_id` carried so reads stay
  tenant-scoped and **always forced from the owner session, never request input**
  (a field's business always equals its form's business); NOT-NULL `label`;
  `type` (`form_field_type`: `short_text`/`long_text`/`rating`/`single_select`/
  `yes_no`); `required` (NOT NULL default false); `position` (integer,
  re-sequenced 0..n from the editor's array order on each save); `options`
  (jsonb, `{id,label}[]` for `single_select` only — null otherwise; option `id`
  is stable across saves so a later phase can store it as the answer). Indexed on
  `(business_id, form_id)`. The whole form saves transactionally via
  `saveForm` on the tenant repo (verify ownership, update meta, reconcile fields
  — insert new with a **DB-generated PK (client temp/forged ids are discarded)**,
  update owned, delete removed, re-sequence positions, preserve option ids).
  Validation is shared Zod in `src/lib/validation.ts`; the client editor is
  `src/components/FormEditor.tsx`; owner pages are `/app/forms` (list) and
  `/app/forms/[id]` (editor). `rating` is a fixed 1–5 scale and `yes_no` a fixed
  two-option choice (no per-field config). **PUBLISH LOCK (1b)**: once a form is
  `published`, `saveForm` rejects any field-structure change (add/delete/reorder/
  type/required/options/label) with `{ ok:false, reason:"locked" }` — the owner
  unpublishes to edit; title/description stay editable. The editor disables field
  controls when published to mirror this.
- **Inventory of form-builder Phase 1b (publish + public collection + QR):**
  - `form_response` — one submission to a form. `business_id` denormalised and
    ALWAYS set server-side from the FORM, never request input; NOT-NULL `form_id`
    → `form` (cascade); `channel` (`form_channel`: `public` = the `/f/<slug>`
    route, `internal` = the PIN-gated staff `/me` portal, Phase 2); nullable
    `source` ("qr"/"link"/"internal"); **Phase 2** `respondent_staff_id` (uuid,
    nullable, FK → `staff_member` **ON DELETE SET NULL**) — the attributed staff
    member for an internal response, ALWAYS resolved server-side from the /me
    session (never request input), NULL for public AND anonymous responses;
    `submitted_at`. Indexed on `(business_id, form_id)` and `(form_id,
submitted_at)`, plus a **partial unique `(form_id, respondent_staff_id)
WHERE respondent_staff_id IS NOT NULL`** — the AUTHORITATIVE one-response-
    per-staff guard for attributed forms (anonymous rows have a null respondent
    → excluded, so multiple are fine). A deleted attributed staff (link nulled)
    reads as "Former staff", derived from the form's frozen `allow_anonymous`,
    NEVER mislabelled "Anonymous".
  - `form_response_answer` — one answer, a **self-describing snapshot**:
    `field_label` + `field_type` captured at submit, and `field_id` → `form_field`
    is **ON DELETE SET NULL** (nullable) so answers SURVIVE later field edits or
    deletion. `value_text` xor `value_number` (DB `CHECK num_nonnulls(...)=1`):
    `rating` → `value_number` (1–5, for trivial AVG/COUNT later), everything else
    → `value_text` (`single_select` stores the chosen option's LABEL after the
    submitted option id was validated against the field's stored ids). `business_id`
    forced from the response. Indexed on `(response_id)` and `(business_id,
field_id)`.
  - `form_rate_limit` — durable fixed-window counter for public submissions
    (`bucket_key` PK = hash(IP+slug+window), `count`, `expires_at`). Durable (not
    in-memory) like the PIN lockout, since the app runs on many serverless
    instances. Coarse per-(IP,slug) ceilings (40/min, 400/hour) sized for the
    QR-in-a-busy-venue case — Turnstile is the primary bot gate. Logic in
    `src/lib/rate-limit.ts` (IPs hashed, never stored raw).
  - **Public route `/f/[slug]`** lives OUTSIDE `/app` (root layout, no session,
    `force-dynamic`); `findPublishedFormBySlug` resolves ONLY published forms
    (draft/closed/unknown → 404) and exposes no owner data — the page passes the
    client only `{ label, type, required, options:[{id,label}] }`. Submit order is
    **honeypot (silent drop) → rate-limit → Turnstile verify → validate → store**
    (`src/lib/form-response-submission.ts`); per-answer validation is pure in
    `src/lib/form-submission.ts`. Turnstile is verified server-side
    (`src/lib/turnstile.ts`) and **fails closed** when `TURNSTILE_SECRET_KEY` is
    unset (both keys are optional in `env.ts` so boot never breaks; set them in
    Vercel before publishing). QR is the public URL rendered server-side via the
    `qrcode` lib (no separate route/channel).
  - **Owner responses view (Phase 1c)** — authenticated, owner-scoped (NEVER the
    public slug resolver). `/app/forms/[id]/responses` shows per-field
    **summaries** on top (rating average + 1–5 distribution bars, single_select/
    yes_no tallies, recent text — "no ratings yet" handled) over a **paginated**
    response list (page size 25, `?page=`, deterministic order `submitted_at
DESC, id DESC`), each row an expandable `<details>` rendering `field_label →
value` from the **answer snapshot**. Summaries are SQL-aggregated
    (`getResponseSummaryAggregates` GROUP BY + `getRecentTextAnswers` window —
    one answer maps to one response, so no fan-out) then shaped by the pure,
    unit-tested `src/lib/form-report.ts`: it groups by `field_id` when present,
    falls back to the `(field_label, field_type)` snapshot for deleted fields
    (shown, flagged "removed field"), and `displayAnswer` is the single source of
    truth for which column each type reads (`rating` → `value_number`, else
    `value_text`). `listForms` carries `fieldCount`/`responseCount` as
    **correlated scalar subqueries** (NOT joins — joining both would fan out and
    multiply the counts). **Delete guard**: `deleteForm(id, { confirmed })`
    refuses (returns `{ ok:false, reason:"has_responses", count }`) when a form
    has responses and `confirmed` isn't set, so collected responses can't be
    wiped by accident; the list page shows a count-aware confirm. No
    per-response edit/delete, no new public surface.
  - **CSV export** — `GET /app/forms/[id]/responses/export` (owner session via
    `ownerRepo`; `getFormExport` 404s when the form isn't this business's, never
    the public resolver). The pure `buildResponsesCsv` (`src/lib/form-export.ts`)
    writes metadata columns (submitted_at ISO, channel, **respondent** (Phase 2),
    source, response id) + the live fields in position order + appended **orphan
    columns** for since-deleted fields (snapshot label + " (removed)",
    deterministically ordered) so nothing is dropped; values via the shared
    `displayAnswer`. Every cell goes through `csvField` (RFC-4180 escape +
    **formula-injection** neutralisation — see below). UTF-8 BOM + `text/csv;
charset=utf-8` + attachment with a slugified filename. **Buffered, newest-10k
    cap** (`EXPORT_CAP`), no streaming/XLSX/scheduling.
- **Form builder Phase 2 (staff / internal channel)**: owners can share a form
  to STAFF and staff fill it from their PIN-gated `/me` portal, with a per-form
  anonymity choice. **NO change to the public `/f/<slug>` surface or its abuse
  pipeline.** Two INDEPENDENT per-form controls on the editor's Sharing panel:
  `internal_enabled` (staff can see + fill it; independent of the public publish
  state — a form can be staff-only, public-only, or both) and `allow_anonymous`
  (whether staff responses are anonymous; frozen once the first internal response
  exists, with clear copy that anonymity can't be undone for collected data).
  - **Staff fill** lives at `/me/forms/[id]` under the SAME `/me` gate (capability
    cookie + short-lived HMAC PIN proof). The respondent identity comes ONLY from
    `verifiedNoticesStaff` (`src/lib/notices-session.ts`) — server-resolved,
    NEVER from request input. The `/me` page lists `internal_enabled` forms with
    an "already responded" state for attributed forms (UX only). The client gets
    the SAME safe field projection as `PublicFormFill` (no `business_id`/internal
    columns); `StaffFormFill` reuses the public fill UI minus honeypot/Turnstile
    (the PIN gate is the control).
  - **Anonymity model**: `allow_anonymous = true` → ANONYMOUS — `respondent_staff_id`
    is NEVER written (null); one-response-per-person CANNOT be enforced (accepted).
    `allow_anonymous = false` → ATTRIBUTED — `respondent_staff_id` = the
    PIN-authenticated staff id; **one response per staff per form** enforced
    AUTHORITATIVELY by a partial-unique `ON CONFLICT DO NOTHING` inside
    `createInternalResponse` (race-safe; the list's "already responded" is UX
    only). The `anonymous` flag passed to the store is read SERVER-SIDE from the
    form's `allow_anonymous`, never the client (a client can't flip an attributed
    form to anonymous to dodge attribution + the guard).
  - **Validation** REUSES `validatePublicSubmission` verbatim (unknown field /
    bad single_select id / rating range rejected); the store re-checks the form
    is this business's AND `internal_enabled` before writing; `business_id` is
    forced on the response + every answer. Submission core is the pure
    `processInternalSubmission` (`src/lib/internal-form-submission.ts`).
  - **Field-structure lock broadened**: `saveForm` freezes fields when
    `published` **OR** `internal_enabled` (turn the channel off to edit;
    snapshots still protect history). Title/description stay editable.
  - **Abuse**: the attributed path is bounded by the partial unique. The
    anonymous path adds a COARSE per-FORM flood cap (`consumeInternalAnonSubmission`,
    keyed on `internal:<formId>:<window>` — **never a staff identifier**, which
    would be a de-anonymisation vector). No Turnstile/honeypot (PIN-gated).
  - **Owner responses view + CSV** show the respondent via the shared
    `respondentLabel` (Public / Anonymous / staff name / **Former staff** when an
    attributed staff was deleted — derived off the form's frozen `allow_anonymous`,
    not off the null). Internal responses flow into the existing 1c summaries and
    CSV with no extra work (the SQL aggregation is channel-agnostic).
- `google_drive_connection` — one Google Drive link per business (**UNIQUE
  `business_id`**, cascade). `google_account_email` (display only); `access_token_enc`
  / `refresh_token_enc` (AES-256-GCM ciphertext — NEVER plaintext, never sent to
  the client, never logged); `token_expiry` (timestamptz, drives the refresh
  check); `root_folder_id` (the app-created "Roster Documents" folder, nullable
  until first folder create); `needs_reconnect` (NOT NULL default false — set when
  a refresh hits `invalid_grant`, surfaced as a reconnect prompt, cleared on a
  successful connect/refresh); `created_at`/`updated_at`. Written via the
  tenant-scoped `upsertDriveConnection`/`updateDriveAccessToken`/
  `markDriveNeedsReconnect`/`setDriveRootFolder`/`deleteDriveConnection`. The
  owner Auth.js login is SEPARATE and untouched — this is additive authorization
  only. **drive.file scope only; files live in the owner's Drive.**
- `staff_document` — a per-staff REFERENCE to a file in the owner's Drive (the
  app never stores the bytes). NOT-NULL `business_id` (cascade) + `staff_member_id`
  (cascade); `file_name`; `doc_type` (nullable free text — Contract/RSA/ID/Other);
  `drive_file_id` + `drive_web_link` (the file's identity + view URL in Drive);
  `mime_type`; `uploaded_at`/`created_at`. Indexed on `business_id` and
  `(business_id, staff_member_id)`. Created by `uploadDocumentToDrive` after the
  bytes are streamed to Drive; `deleteDocument` removes this row AND (best-effort)
  the Drive file the app created.
- `pay_rule` — one owner-authored pay-classification rule (M28). NOT-NULL
  `name`; `priority` (integer — the owner-visible precedence; lower first;
  created at max+1, reordered by a transactional renumber-and-swap
  `movePayRule`); `is_active` (NOT NULL default true); `condition_type`
  (`pay_rule_condition_type`: `day_of_week`/`time_of_day_after`/
  `time_of_day_before`/`daily_hours_beyond`/`weekly_hours_beyond`);
  `condition_config` (jsonb, zod-validated per type, stored WITHOUT the type);
  `earnings_rate_id` + `earnings_rate_name` (a REFERENCE to the owner's Xero
  pay item + display snapshot re-read from Xero on save). Indexed on
  `business_id` and `(business_id, priority)`. **Deliberately NO rate,
  multiplier, percent or dollar column, and the table ships EMPTY** (guard
  tests pin both). Pure evaluation in `src/lib/xero/pay-rules.ts`; owner CRUD
  on `/app/xero/rules`.

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
- [x] M19 — Form builder Phase 1a (builder CRUD only): owner-authenticated `form` + `form_field` tables, owner-labelled fields of five v1 types, single transactional `saveForm` reconcile (tenant-scoped, IDOR-guarded, stable option ids), `/app/forms` list + `/app/forms/[id]` editor (no publishing, no public routes, no responses — later phases)
- [x] M20 — Form builder Phase 1b (publish + public collection + QR): owner publish/close + public URL/copy/QR; public `/f/[slug]` route (outside `/app`) storing anonymous `form_response`/`form_response_answer` (self-describing snapshots, rating in `value_number`); abuse protection (Cloudflare Turnstile server-side fail-closed, honeypot, durable per-IP/slug `form_rate_limit`); publish lock freezes a published form's fields. Owner responses view deferred to 1c.
- [x] M21 — Form builder Phase 1c (owner responses view + delete guard): owner-scoped `/app/forms/[id]/responses` with SQL-aggregated per-field summaries (rating average+distribution, select/yes_no tallies, recent text) shaped by the pure `form-report.ts` (snapshot grouping, `displayAnswer`), a paginated `<details>` response list (deterministic order), response counts on the list/editor, and a `deleteForm` confirmed-flag guard so responses can't be wiped accidentally. Read-only; no migration; no export.
- [x] M22 — Form builder Phase 2 (staff / internal channel): owner per-form `internal_enabled` + `allow_anonymous` controls; staff fill internal forms from the PIN-gated `/me/forms/[id]` portal (respondent server-resolved from the /me session, never request input; reuses `validatePublicSubmission`, no Turnstile/honeypot); attributed (`respondent_staff_id`, one-per-staff via partial-unique ON CONFLICT) vs anonymous (null respondent, coarse per-form rate limit keyed on form id only); field-lock broadened to published OR internal_enabled; responses view + CSV show the respondent (Public/Anonymous/name/Former staff). Additive migration 0015. No change to the public `/f/[slug]` surface.
- [x] M23 — Form builder Phase 3a (new-response owner notifications): a sixth `notification_type` `form_response` reusing the existing bell + per-event preference (`business.notify_form_response`); fired best-effort AFTER the response commits from both submission cores, ONLY on a genuine new row (never honeypot/reject/`already_responded`); COALESCED into one updating unread row per form via `notification.group_key` + `count` and a partial unique index (count-only/no answer content/no respondent identity — uniform for public/attributed/anonymous); reading the row resets it. Additive migration 0016. In-app bell only (email digest deferred).
- [x] M24 — Inbound SSO from prompt2eat (`POST /api/sso/prompt2eat`): verify a single-use EdDSA/Ed25519 JWS (POST body, ≤60s TTL) against the pinned `PROMPT2EAT_SSO_PUBLIC_KEY` (fail-closed); pin `iss`/`aud`/`alg` + `exp`/`iat` (≤30s skew); `jti` single-use via `sso_consumed_tokens` (GC'd ~10 min); match-or-provision the owner by verified email in Roster's own `user` table (case-insensitive); mint Roster's own Auth.js database session and 303-redirect to a fixed `/app` (failures → `/sign-in?error=sso`). Separate identity stores, no shared cookie/table/secret; Roster verifies but never mints. Additive migration 0017. Contract in `docs/roster-sso-contract.md`.
- [x] M25 — Google Drive document storage (Phase 1 of 4): owners connect their OWN Google Drive (drive.file scope only, additive OAuth authorization — NOT a login; Auth.js untouched) and upload per-staff documents stored in their Drive with the app holding only a reference. AES-256-GCM token encryption (`TOKEN_ENCRYPTION_KEY`, fail-closed), CSRF-state OAuth connect/callback (businessId from session), token refresh + revoke→reconnect handling, 10 MB + mime-allow-list upload-through-server (bytes never persisted/logged), document list + delete (also deletes the Drive file the app created), disconnect ≠ delete. Mockable `DriveClient` (google-auth-library + Drive v3 REST). Additive migration 0018 (`google_drive_connection`, `staff_document`). **Later phases (separate PRs): OneDrive, Dropbox, per-employee onboarding/offboarding checklists.**
- [x] M26 — High-fidelity redesign to the "Roster" design handoff (`design/`, plan in `docs/design-implementation-plan.md`): a **presentation-only** overhaul — no schema, server-action, validation or tenancy changes. Widened the owner area to the design's 1340px layout with a single-row dark top bar + ROSTER wordmark; expanded `src/components/ui.tsx` into the full kit (Button variants, Card/SectionCard/Eyebrow, KpiTile, Avatar, Switch, Toast, refined Badge/Banner/Field/TextInput/PageHeader) plus `src/lib/avatar.ts` (deterministic initials+colour). Restyled every screen to its screenshot: dashboard, roster periods, shift types, the roster builder (staff×day matrix grid + preserved assignment editor), timesheets, reports, staff (two-pane list+detail), leave, certs, stock, items, suppliers, settings, notifications, and the bare/staff surfaces (marketing landing, sign-in/check-email/onboarding on the green wash, and the dark kiosk + personal-phone clock-in). Design elements without backing data (item Category/Reorder, supplier Category, staff role) are shown as clearly-labelled placeholders and tracked in the plan doc. Follow-up: designed the four staff phone surfaces the handoff left visually undefined — /me notices (per-type icon chips + branded PIN gate), /r public roster (per-day cards with shift-colour dots), /a availability (colour dots + I-can-work/Can't toggles) via a shared StaffHeader — and gave the kiosk/personal-phone sub-flows (leave/stock/shift-swap forms + shift lists) a coherent dark treatment (shared KioskForm module).
- [x] M27 — Xero Payroll AU integration: owners connect their Xero org (owner OAuth **or** a delegated single-use bookkeeper invite consumed atomically in the callback), confirm the org name (a push is refused until `active`), map staff→Xero employees with an auto-resolved + owner-editable ordinary earnings rate, and push **approved, closed** hours as **DRAFT** timesheets per employee's Xero pay period (dates read straight from Xero — no local period math). **HARD BOUNDARY: draft timesheets only.** The narrow raw-`fetch` client (NOT `xero-node`) has NO pay-run, NO approve/revert, NO employee-write method (a guard test pins the exact method set), and never requests `payroll.payruns`. Payroll **2.0** wire shapes (ISO dates, `payrollCalendarID`, per-day scalar `numberOfUnits`, title-case `Draft`, `{timesheet}` envelope, real DELETE) source-verified from Xero's generated 2.0 SDK models; the **base-path + scope are isolated in `src/lib/xero/tokens.ts` for a first-live-AU-connect verify** (README checklist). Re-push = delete-then-create with the invariant `xero_timesheet_id` non-null ⟺ a live Draft (id nulled the instant delete succeeds → a distinct "no draft exists" failure state) and a **per-attempt idempotency key** (`base + ":attempt=" + attempt`) so a post-delete replay can't return Xero's cached deleted-timesheet response; cancel guards still-Draft (typed `XeroTimesheetAlreadyActioned`). Tokens AES-256-GCM encrypted (shared `TOKEN_ENCRYPTION_KEY`, fail-closed; Xero rotates refresh tokens → both persisted on refresh). Additive migrations `0019` (4 tables) + `0020` (`attempt`). Full plan + decision history (incl. the corrected 1.0→2.0 reversal): `docs/xero-payroll-integration-plan.md`.
- [x] M28 — Owner-configured pay-classification rules: mechanical, owner-authored rules (`/app/xero/rules`) that sort pushed hours onto the owner's OWN Xero pay items, splitting shifts into multiple per-line-`earningsRateID` draft-timesheet lines (additive on the M27 push — the client method set is untouched and everything stays a Draft). **HARD BOUNDARY: ZERO built-in award rules / default percentages / award names anywhere; the `pay_rule` table ships EMPTY and stores NO dollar figure and NO multiplier** — only condition + pay-item reference; guard-tested (exact column set, INSERT-free migration, vocabulary scan: `tests/pay-rules-boundary.test.ts`). Pure deterministic classifier (`src/lib/xero/pay-rules.ts`): sub-block splitting at midnights/time cutoffs/threshold crossings, first-match-wins by the owner's reorderable list, moment-local wall-clock conditions, Monday-start weekly cumulation with context fetch, per-day 2dp reconciliation — zero rules ⇒ output identical to `buildTimesheetLines`. Rule edits re-push via the payload hash (existing delete-then-create); stale pay items block the push by name; the pre-push preview shows every shift's split. Additive migration `0021`. Plan: `docs/pay-rules-plan.md`.
- [~] M29 — Multi-location & shared staff pool (Strategy A; **Phases 0–2 built**): one owner runs several **locations** under one **organisation** with a shared org-wide staff pool that can be placed/lent across locations. Phase 0 — additive `organisation`/`org_membership`/`staff_location` + `business.org_id`/`staff_member.org_id`, idempotent backfill (one org per business, id-reused 1:1; mirrored+tested `backfillOrgs`; migration `0023`). Phase 1 — `requireOwner` resolves org (membership) + a VALIDATED active location (N2), `createOrgRepo`/`ownerContext`, header **location switcher**, `/app/locations`, org-aware onboarding. Phase 2 — staff collapse: tenant-repo staff scoping becomes membership-based (`memberHere` = home OR active `staff_location`, backward compatible), `addStaff` creates the org row + home membership, org **People** page (`/app/people`) with per-location membership chips → cross-location staffing. Org invariants N1–N5 (see Non-negotiable conventions → Multi-tenancy). Tests: `tests/org-backfill-flow`, `org-repository-flow`, `org-people-flow`. **Follow-ups (not built):** staff-initiated cross-location shift cover (`shift_offer.scope`) + date-ranged `staff_loan`. Plan: `docs/multi-location-plan.md`.
