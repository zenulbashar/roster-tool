# Roster

Dead-simple staff scheduling for small businesses. Ask your team when they're
free, build the week's roster, and email everyone their shifts — no app for
staff to install, no jargon.

> **Status:** in active development. See `CLAUDE.md` for architecture and
> conventions, and the milestone checklist below for what's built.

## Tech stack

- **Next.js (App Router) + TypeScript** — web app
- **PostgreSQL + Drizzle ORM** — data + migrations
- **Auth.js** — owner sign-in (email magic link)
- **Resend** (prod) / **Mailpit** (local) — transactional email
- **pg-boss** — Postgres-backed background jobs (emails, reminders)
- **Tailwind CSS** — minimal, accessible, high-contrast UI
- **Vitest** — unit + integration tests

## One-command local setup

Prerequisites: Node 22+, Docker.

```bash
cp .env.example .env        # defaults work out of the box for local dev
npm install
npm run dev:setup           # starts Postgres + Mailpit, migrates, seeds demo data
npm run dev                 # start the app at http://localhost:3000
```

- App: http://localhost:3000
- Mailpit inbox (all outgoing email, incl. magic links): http://localhost:8025

To run the background worker (sends queued emails and reminders):

```bash
npm run worker
```

## How the flow works

1. **Owner signs in** with a magic link and their business is created.
2. **Owner adds staff** (name + email) and defines reusable **shift templates**
   (e.g. Morning 7am–12pm).
3. **Owner creates a roster period** (e.g. next week). Templates expand into
   concrete shifts for each day.
4. **Owner requests availability.** Each staff member is emailed a unique magic
   link to a no-login page where they tap Available / Not available per shift.
5. **Reminders** go out automatically to anyone who hasn't responded before the
   deadline.
6. **Owner reviews availability** and assigns people to shifts.
7. **Owner publishes.** Everyone is emailed their personal roster, and a
   read-only shareable view is created.

## Useful commands

| Command               | What it does                                      |
| --------------------- | ------------------------------------------------- |
| `npm run dev`         | Start the app in development                      |
| `npm run worker`      | Run the background job worker                     |
| `npm run db:generate` | Generate a migration from schema changes          |
| `npm run db:migrate`  | Apply migrations                                  |
| `npm run db:seed`     | Seed a demo business with staff + a sample period |
| `npm run typecheck`   | TypeScript check                                  |
| `npm run lint`        | ESLint                                            |
| `npm test`            | Run the test suite                                |

## Production deployment

The app runs on **Vercel**, the background worker on **Railway**, and both share
one **Neon** Postgres database. Email goes through **Resend**. You can follow
these steps without being a developer — just copy/paste carefully.

You'll need accounts for: Neon (database), Vercel (web app), Railway (worker),
Resend (email), and Cloudflare (DNS for `zaleit.com.au`).

Two ready-made env templates list exactly what each platform needs:

- `.env.vercel.example` — the web app
- `.env.railway.example` — the worker

Both use the **same** Neon database, with one difference: Vercel uses Neon's
**pooled** connection string (host contains `-pooler`) and the worker uses the
**direct** one (no `-pooler`), because the job system (pg-boss) needs a direct
connection.

### 1. Create the database tables (run once)

In the Neon dashboard, create a project in the **Sydney (ap-southeast-2)**
region and copy its connection string.

On your computer, in the project folder, create a temporary file called `.env`
with two lines (the migration tool reads both):

```
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-2.aws.neon.tech/roster?sslmode=require
AUTH_SECRET=anything-non-empty-for-this-one-off-step
```

Use the **direct** connection string here, and make sure it ends with
`?sslmode=require`. Then run:

```bash
npm install
npm run db:migrate
```

You should see "Migrations applied." Delete that temporary `.env` afterwards.
(The worker creates its own job tables automatically the first time it starts —
nothing extra to do.)

This manual run is only needed for the **first** deploy. After that, the
`migrate-prod` job in `.github/workflows/ci.yml` auto-applies pending
migrations to production on every merge to `main` (after the `build`/test job
passes). Add two repository secrets (GitHub → **Settings → Secrets and
variables → Actions**) for it to work:

- `PROD_DATABASE_URL` — the Neon **direct** (non-pooled) connection string.
- `AUTH_SECRET` — the same value as production (the migration script validates
  the whole env at import, so it won't boot without it).

The job is for **additive/expand** migrations only; destructive migrations
(drop/rename/retype) must still be run manually using expand/contract.

### 2. Generate a sign-in secret

Run this once and keep the output — you'll paste the **same** value into both
Vercel and Railway:

```bash
npx auth secret
```

### 3. Deploy the web app to Vercel

1. Go to Vercel → **Add New… → Project** and import the `zenulbashar/roster-tool`
   repo from GitHub.
2. Framework is auto-detected (Next.js). Leave the build settings as-is —
   `vercel.json` already configures them.
3. Open **Settings → Environment Variables** and add every variable from
   `.env.vercel.example` (Production scope), using:
   - your Neon **pooled** `DATABASE_URL` (host has `-pooler`, ends with
     `?sslmode=require`),
   - the `AUTH_SECRET` from step 2,
   - `AUTH_URL` and `APP_URL` both set to `https://roster.zaleit.com.au`,
   - `EMAIL_TRANSPORT=resend`, `EMAIL_FROM=Roster <roster@zaleit.com.au>`, and
     your `RESEND_API_KEY`,
   - `TURNSTILE_SECRET_KEY` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` from a
     Cloudflare Turnstile widget — **both must be set before any owner publishes
     a form**; the public form route verifies Turnstile server-side and fails
     closed (rejects all submissions) if the secret is missing.
4. Click **Deploy**. (Set the env vars _before_ deploying — the build checks
   them.)

### 4. Deploy the worker to Railway

1. Go to Railway → **New Project → Deploy from GitHub repo** and pick
   `zenulbashar/roster-tool`.
2. Railway will detect the `Dockerfile` and build the worker image. It needs no
   public port — it's a background process, not a website.
3. Open the service's **Variables** tab and add every variable from
   `.env.railway.example`, using:
   - your Neon **direct** `DATABASE_URL` (host has **no** `-pooler`, ends with
     `?sslmode=require`),
   - the **same** `AUTH_SECRET` as Vercel,
   - `APP_URL=https://roster.zaleit.com.au`,
   - `EMAIL_TRANSPORT=resend`, `EMAIL_FROM=Roster <roster@zaleit.com.au>`, and
     your `RESEND_API_KEY`.
4. Deploy. The logs should show "Workers registered" and "Worker started.
   Waiting for jobs…".

### 5. Point roster.zaleit.com.au at Vercel (Cloudflare DNS)

1. In Vercel → the project → **Settings → Domains**, add
   `roster.zaleit.com.au`. Vercel will show a CNAME target (usually
   `cname.vercel-dns.com`).
2. In Cloudflare → `zaleit.com.au` → **DNS → Records → Add record**:
   - Type: **CNAME**
   - Name: **roster**
   - Target: the value Vercel gave you (e.g. `cname.vercel-dns.com`)
   - Proxy status: **DNS only** (grey cloud) while Vercel issues the SSL
     certificate; you can switch it to Proxied later if you like.
3. Wait a few minutes for Vercel to verify the domain and issue HTTPS. Then open
   `https://roster.zaleit.com.au` and sign in.

### Quick check it's all working

Sign in as the owner, add yourself as a staff member, create a roster, and send
an availability request. You should receive a real email from
`roster@zaleit.com.au` within a minute (sent by the Railway worker). If emails
don't arrive, check the Railway worker logs and the Resend dashboard.

### 6. (Optional) Enable Google Drive document storage

This lets owners connect their own Google Drive and upload staff documents
(stored in their Drive; the app keeps only a link). It's off until you configure
it. In the **Google Cloud Console**:

1. Create (or pick) a project and **enable the Google Drive API**.
2. Configure the **OAuth consent screen** (External). While the app is in
   "Testing" only the test users you list can connect; **Google may require app
   verification before the public can connect** (the `drive.file` scope is
   non-sensitive, which usually keeps verification light, but allow time).
3. Create an **OAuth client ID** of type **Web application**. Add this exact
   **authorized redirect URI**:
   `https://roster.zaleit.com.au/api/integrations/google/callback`
4. In **Vercel → Settings → Environment Variables (Production)** set:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (from the OAuth client)
   - `GOOGLE_OAUTH_REDIRECT_URI` = the redirect URI above (must match exactly)
   - `TOKEN_ENCRYPTION_KEY` = a base64 of 32 random bytes, generated with:
     `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
     — **keep this safe and never rotate it without re-connecting**, as it
     decrypts the stored tokens.

Redeploy. Owners will then see **Connect Google Drive** in Settings. The flow
**fails closed**: if any of these four are missing, connecting stays disabled and
no token is ever stored. The worker does **not** need these (no Drive jobs).

### 7. (Optional) Enable Xero Payroll AU

Owners connect their Xero org and push **approved** hours as **DRAFT** timesheets
for a human to approve + run inside Xero. The app has **no pay-run capability**
and never calculates pay. It's off until you configure it. On **developer.xero.com**:

1. Create an **OAuth 2.0 app** and add this exact redirect URI:
   `https://roster.zaleit.com.au/api/integrations/xero/callback`
2. Grant only **read/timesheet** scopes: `openid profile email offline_access
payroll.timesheets payroll.employees.read payroll.settings.read` — **never
   `payroll.payruns`**.
3. In **Vercel → Environment Variables (Production)** set `XERO_CLIENT_ID`,
   `XERO_CLIENT_SECRET`, `XERO_OAUTH_REDIRECT_URI` (the URI above), and reuse the
   same `TOKEN_ENCRYPTION_KEY` as Google Drive. The connect flow **fails closed**
   until all are present. Both the owner and a delegated bookkeeper (via a
   one-time invite link) can complete the connection; the owner then confirms the
   org name before anything can push.

> #### ⚠️ Xero — live-verify checklist (do at the FIRST live AU connect, before any real business uses it)
>
> Two Xero facts could not be confirmed from the docs (they 403 automated fetch)
> and are isolated in `src/lib/xero/tokens.ts` for exactly this reason. Verify
> them against a **real AU demo company** post-connect, before go-live:
>
> 1. **`XERO_TIMESHEET_BASE_PATH`** (`https://api.xero.com/payroll.xro/2.0`) — a
>    `GET`/`POST` to `/Timesheets` is accepted for an **AU** tenant. If AU uses a
>    different base for 2.0 timesheets, change this one constant.
> 2. **`XERO_TIMESHEET_SCOPE`** (`payroll.timesheets`) — this scope actually grants
>    AU 2.0 timesheet access. If AU needs a version-specific scope, change this one
>    constant (no re-consent concern before launch — no owner is connected yet).
>
> Everything else (ISO dates, `payrollCalendarID`, per-day scalar `numberOfUnits`,
> title-case `Draft`, the DELETE/response envelope) is verified from Xero's
> generated 2.0 SDK models. Full history + rationale: `docs/xero-payroll-integration-plan.md`.

The worker does **not** need the Xero env (pushes are owner-initiated, no cron).

## Project layout

```
src/
  app/            Next.js routes (owner area, staff magic-link pages, public roster)
  lib/
    db/           Drizzle schema + connection
    auth/         Auth.js config
    email/        Email transport + templates
    jobs/         pg-boss job definitions + handlers
    tenant/       Tenant-scoped data access (business isolation)
    env.ts        Validated environment access
    logger.ts     Structured logging
    time.ts       UTC storage / Sydney display helpers
scripts/          migrate / seed / worker entrypoints
tests/            unit + integration tests
```

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
- [x] M19 — Form builder Phase 1a (builder CRUD only): owner-authenticated forms + fields (five v1 types), single transactional save (tenant-scoped, IDOR-guarded), `/app/forms` list + editor; drafts only — no publishing, public routes or responses (later phases)
- [x] M20 — Form builder Phase 1b (publish + public collection + QR): owner publish/close with public link, copy button and QR; public `/f/[slug]` route (outside `/app`) storing anonymous responses; abuse protection (Cloudflare Turnstile server-side, honeypot, durable per-IP rate limit); published forms' fields are locked. Requires `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Owner responses view is Phase 1c.
- [x] M21 — Form builder Phase 1c (owner responses view + delete guard): owner-scoped `/app/forms/[id]/responses` with per-field summaries (rating average + distribution, select/yes-no tallies, recent text) and a paginated, snapshot-rendered response list; response counts on the forms list/editor; deleting a form with responses requires explicit confirmation. Read-only, no migration.
- [x] Form builder — CSV export of responses: owner-only `GET /app/forms/[id]/responses/export` (UTF-8 BOM, metadata + live-field columns + orphan columns for deleted fields, values matching the UI). Hardens the shared CSV serializer against spreadsheet formula injection (applies to all exports). No migration.
- [x] M22 — Form builder Phase 2 (staff / internal channel): owners share a form to staff (`internal_enabled`) with a per-form anonymity choice (`allow_anonymous`); staff fill it from their PIN-gated `/me` portal (respondent resolved server-side from the /me session, never request input; reuses the public validator; no Turnstile/honeypot). Attributed responses are one-per-staff (partial-unique); anonymous responses store no respondent. Field edits lock once published OR shared with staff; the responses view + CSV show the respondent. Additive migration `0015`; the public `/f/[slug]` route is unchanged.
- [x] M23 — Form builder Phase 3a (new-response notifications): the owner gets a coalesced in-app bell notification when a form response arrives (public or staff). A new `form_response` event reuses the existing bell + a per-event preference; notifications collapse into one updating "N new responses to <form>" item per form (count only — never answer content or respondent identity, so anonymous and attributed read identically) and reset when read. Fired best-effort after the response commits, so a notification failure can never break a submit. In-app only (email digest deferred); additive migration `0016`.
- [x] M24 — Google Drive document storage (Phase 1 of 4): owners connect their own Google Drive (drive.file scope only — an additional authorization, NOT a login) from Settings and upload per-staff documents that live in their Drive, with the app storing only a reference. OAuth tokens are AES-256-GCM encrypted (`TOKEN_ENCRYPTION_KEY`, fail-closed); the flow handles refresh + revoke→reconnect without crashing. Uploads stream through the server (10 MB cap + mime allow-list, bytes never stored/logged); delete removes the reference and the Drive file; disconnect leaves Drive files untouched. Additive migration `0017`. Requires Google Cloud setup + env vars (see Production deployment). Later phases (separate): OneDrive, Dropbox, onboarding checklists.
- [x] M26 — High-fidelity UI redesign to the "Roster" design handoff (stored in `design/`, tracked in `docs/design-implementation-plan.md`): presentation-only (no schema/logic/tenancy change). Widened the owner app to a 1340px dark-nav layout with the ROSTER wordmark, expanded the shared UI kit (`src/components/ui.tsx`) + a deterministic avatar helper, and restyled every screen — dashboard, rosters/builder, shift types, timesheets, reports, staff, leave, certs, stock, items, suppliers, settings, notifications, the marketing landing, passwordless auth/onboarding, and the dark kiosk + phone clock-in — to match the design screenshots. Data-model gaps (item category/reorder, supplier category, staff role) are shown as labelled placeholders. Follow-up: the four staff phone pages (/me, /r, /a, /me forms) got bespoke light designs via a shared StaffHeader, and the kiosk/personal-phone sub-flow forms were dark-themed for a coherent clock-in experience.
- [x] M27 — Xero Payroll AU integration: owners connect their Xero org (owner OAuth **or** a delegated single-use bookkeeper invite consumed atomically in the callback), confirm the org name, map staff to Xero employees with an auto-resolved + editable ordinary earnings rate, and push **approved** hours as **DRAFT** timesheets for each employee's Xero pay period (dates read straight from Xero — no local period math). **HARD BOUNDARY: draft timesheets only — the narrow `fetch` client has NO pay-run, approve/revert, or employee-write method (guard-tested), and never requests `payroll.payruns`; a human approves + runs pay in Xero.** Payroll 2.0 wire shapes source-verified from Xero's generated SDK models; the base-path + scope are isolated for a first-live-connect verify (see the Xero live-verify checklist). Re-push is a delete-then-create with an invariant (`xero_timesheet_id` non-null ⟺ a live Draft) and a per-attempt idempotency key so a post-delete replay can't hit Xero's cache; cancel guards still-Draft. Tokens AES-256-GCM encrypted (shared `TOKEN_ENCRYPTION_KEY`, fail-closed). Additive migrations `0019` (4 tables) + `0020` (`attempt`). Plan/history: `docs/xero-payroll-integration-plan.md`.
- [x] M28 — Owner-configured pay-classification rules: on `/app/xero/rules` the owner writes mechanical rules (day-of-week / before-after a time of day / hours beyond a daily or weekly total) that sort pushed hours onto **their own Xero pay items**, split per shift into multiple draft-timesheet lines (per-line `earningsRateID`, Payroll 2.0). **HARD BOUNDARY: Roster ships ZERO built-in rules and stores NO dollar figure and NO multiplier** — the `pay_rule` table (additive migration `0021`) holds only a condition + a pay-item reference and ships empty; every dollar comes from the pay item's setup in Xero, and everything still lands as a Draft (guard-tested, incl. a vocabulary check on the engine/UI). Evaluation is pure + deterministic (`src/lib/xero/pay-rules.ts`): first match wins by the owner's visible list order, unmatched hours stay on the ordinary rate, per-day totals reconcile exactly with the CSV/report (zero rules ⇒ identical output to M27). The pre-push preview expands per employee to show each shift's split; a rule pointing at a deleted pay item pauses the push by name. Plan: `docs/pay-rules-plan.md`.
- [x] M29 — Multi-location & shared staff pool (**Phases 0–4 built**): one owner runs several **locations** under one **organisation**, with a shared org-wide staff pool that can be placed/lent across locations, plus cross-location shift cover and date-ranged loans. A header **location switcher** picks the active location (validated against the org); `/app/locations` adds/switches locations; `/app/people` is the shared pool where the owner drops each person into any location — which is what makes them appear in that location's roster builder, availability and kiosk. Staff are org-level (`staff_member.org_id`) reached per location through `staff_location` membership; **all work records (rosters, timesheets, leave, etc.) stay scoped to their own location, unchanged.** Offering up a shift in a multi-location business makes it claimable at any location (`shift_offer.scope`) — it shows in other locations' kiosk "Open shifts", and the owner's approval grants the claimer a membership at the shift's location before the atomic transfer. Owners can also **lend a person to a location for a date range** (`staff_loan`); the person becomes rosterable there and drops off automatically when the loan ends (daily expiry job) — permanent memberships are never touched. Additive migrations `0023` (org tables + backfill), `0024` (`scope`), `0025` (`staff_loan`). Plan: `docs/multi-location-plan.md`.
- [x] M30 — Drag-and-drop roster board: build/rearrange the roster by dragging — a chip moves a person to another day (the matching block, or a clone when the day has none) or hands the shift to someone else; open shifts drag onto people; dragging to the Open row unassigns (the vacated block shows as open — a slot is never silently lost). Chips colour **by employee** by default (each person's stable colour washed across a proportional 24 h day bar) with a by-shift-type toggle. Clicking a chip opens a schedule editor — drag the handles (or tap ±15 min steppers) to make that person's hours differ from the block (e.g. 9 am – 9 pm), and drop in a 30 min / 1 hour unpaid break the owner can position; the person's own times + break then show on the public roster and their published email. Additive migration `0028` (nullable per-assignment override; existing rosters unchanged); roster breaks never feed timesheets/exports. Plan: `docs/drag-drop-roster-plan.md`.
- [x] M31 — Per-shift staffing levels (multi-staff shifts): shift types carry a **staffing target** (`required_staff`, default 1) snapshotted onto each concrete shift at expansion and adjustable per shift in the builder (a −/+ stepper — "Friday needs one more"). Multiple staff already shared one shift block (unique per (shift, staff)); this makes the NEED visible: a shift stays in the board's Open row until fully staffed ("2 of 3 filled · needs 1 more"), a shortfall pill totals the missing people, the tap editor shows "N of M assigned", and an understaffed warning shows before publish. **A target is a flag, never a block** — assigning more/fewer than the target and publishing understaffed are always allowed. Additive migration `0029`; templates UI gains "How many staff on this shift?".
- [x] M32 — Per-weekday staffing overrides + fill-to-target drafting: shift types gain `day_staff_overrides` (jsonb ISO-weekday → count, mirroring `day_time_overrides` — "Friday needs 4" as a standing rule instead of a weekly stepper tweak; applied only at expansion, pruned to differences, ignored on days the type doesn't run; migration `0030`), and "Draft from last week" now FILLS understaffed shifts: last week's crew keep priority, then shifts below their target top up from active staff who **explicitly said yes** (never an unknown reply, never anyone on leave, never beyond the target), spread by fewest shifts held this week. Existing assignments count toward targets and are never re-suggested; the draft summary reports shifts still short ("no one else said they're available"). Pure + deterministic in `src/lib/draft.ts`; no `staffIds` = the original behaviour.
- [x] M33 — Builder insights: double-booking flags + a rostered labour-cost estimate, both read-only over existing data (pure `src/lib/roster-insights.ts`; no schema change). Overlaps use each chip's EFFECTIVE times (per-assignment overrides included), flag on the chips (live under drag/resize via the board's optimistic state), warn in the drop preview, and list the people/days in a banner — never blocking. The cost strip totals confirmed assignments at net hours x the entered rate with unrated staff named (hours, never $0), server-rendered with LABOUR_COST_DISCLAIMER; suggestions cost nothing. Also de-flaked the cert-reminder notification test (cross-file race on the all-business sweep).
- [x] M34 — Overnight shifts: an end time at or before the start means the shift finishes the NEXT day ("6 pm – 2 am"), anchored to its start date — no schema change. Extended-axis maths in `assignment-schedule.ts` (`spanMinutes`/`extendedRange`/`extendedBreakStart`; validate/segments/worked-minutes/carry all overnight-aware, breaks can sit after midnight); template + day-override validation rejects only equal times, with a "runs into the next day" hint on the forms; `timesOverlap` wraps; M33 overlap detection compares absolute date+minute ranges (cross-midnight clashes caught); every surface prints ranges via the shared `formatTimeRange` ("(next day)" suffix) — builder board/chips/editor, tap editor, templates, public roster, availability, kiosk/clock swap lists, emails, staff reminders. The board's day bar wraps the after-midnight tail; the schedule editor uses a noon-to-noon axis for overnight schedules. Timesheets/CSV/report/Xero untouched (they read clock timestamps, which always handled overnight).
- [x] M30 — Unpaid breaks on timesheets + mobile roster-periods fix: the owner records an unpaid break (None / 30 min / 1 hour) on a clock-in entry on `/app/timesheets`; it is **subtracted from worked hours** (`break_minutes`, additive migration `0027`) everywhere hours are shown/exported/reported — the Timesheets Hours column, the CSV export (a new **Break (min)** column + NET total), the labour-cost report, and the Xero draft push (netted via the shared `hoursWorked`, split proportionally across pay-item lines so days still reconcile; zero rules ⇒ still identical to `buildTimesheetLines`). Clamped at zero and validated to be shorter than the shift; still an **estimate**, not a payroll calculation. Also fixed a mobile bug where the `/app/periods` Build/View button was clipped off the right edge (the list row now wraps).
