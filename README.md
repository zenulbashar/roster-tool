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
     your `RESEND_API_KEY`.
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
