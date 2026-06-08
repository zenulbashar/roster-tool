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
reminder before the deadline, and staff clock-in (a shared-device kiosk with
per-staff PINs) feeding owner-facing timesheets.

**Out of scope (post-MVP):** SMS/WhatsApp, payroll, free-text reply parsing,
billing, native apps, shift-swap workflows. If a request drifts here, flag it
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
  deleting a timesheet entry deletes its photos. No auto-retention/purge yet —
  recommended follow-up. Camera-denied/unavailable falls back to PIN-only; a
  missing photo never blocks clocking.

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
`roster_assignment`, `published_roster`, `timesheet_entry`, `clock_photo`. All
domain tables are business-scoped.

Notable columns / conventions:

- `staff_member.notify_by_default` — pre-checks this person when the owner asks
  for availability. Owners override per-send on the recipient-selection step.
- `staff_member.pin_hash` — salted scrypt hash of the kiosk PIN (`scrypt$salt$hash`).
  `failed_pin_attempts` / `pin_locked_until` back the per-staff brute-force guard
  (5 wrong PINs → 60s cooldown). Helpers (hash, verify, lockout) are pure in
  `src/lib/pin.ts`; the PIN itself is never stored or logged.
- `business.kiosk_token_hash` — SHA-256 hash of the kiosk capability token (only
  the hash is stored; raw token lives in the link/cookie). `require_clock_in_photo`
  toggles kiosk photo capture (off by default).
- `timesheet_entry` — one clock in/out. `clock_out_at` null = currently in; a
  **partial unique index** on `staff_member_id WHERE clock_out_at IS NULL` makes
  double clock-in impossible. `shift_id` links a rostered shift when one matches
  (published + confirmed) on the clock-in's business-local date, else null.
  `approved` is the owner's payroll sign-off. Clock logic is pure in
  `src/lib/clock.ts`.
- `clock_photo` — optional clock in/out still, stored inline as `bytea`, cascaded
  with its entry. Served only to the owner via `/app/timesheets/photo/[id]`.
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
  template was deleted) **and** weekday, suggesting only available staff.

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
