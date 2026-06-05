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
- [ ] M7 — Publish + reminders (jobs)
- [ ] M8 — Accessibility + polish
