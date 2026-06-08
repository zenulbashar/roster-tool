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
approves — see below).

**Out of scope (post-MVP):** SMS/WhatsApp, **payroll / wage calculation**
(award interpretation, penalty rates, overtime, loading, super, STP — the app
only records hours and a rate the owner typed, and shows an `hours × rate`
estimate), **payroll API integration** (Xero/MYOB — file export only),
**leave balances / accruals / entitlements** and any **NES/award leave
calculation** (leave is request → approve/deny → record only),
**bilateral A↔B shift swaps** and **auto-approval** of swaps (the owner always
approves the handover; only one-directional release/claim is built),
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
`leave_request`, `shift_offer`. All domain tables are business-scoped.

Notable columns / conventions:

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
