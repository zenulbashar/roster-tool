# Operations runbook

How Roster is run in production: what we promise (RTO/RPO, SLOs), what we
rely on (Neon point-in-time recovery, the worker heartbeat, the dead-letter
queue), how we prove it still works (restore drills), and what to do when
something breaks (runbooks). This is the artefact enterprise procurement asks
for under "business continuity" and the document an on-call engineer opens at
2 am. It resolves audit finding `OPS-03` and records the published SLOs from
`OPS-01` item 7 (`docs/platform-audit-2026-07.md`).

**Owner:** Zale IT platform team. **Review:** after every restore drill and
every incident, and at least quarterly. Facts about the hosted platforms
(Neon, Vercel, Railway, Resend) live outside this repository — the
[configuration record](#33-configuration-record) below is where they are
written down, and it is only trustworthy if the last drill date on it is
recent.

---

## 1. Topology

| Component         | Where                                                | Notes                                                                                                                                                                                                                                                                          |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web app           | Vercel, region `syd1` (`vercel.json`)                | Next.js; serverless. Connects to Neon through the **pooled** connection string. Send-only pg-boss producer (`PERF-07`).                                                                                                                                                        |
| Background worker | Railway, one container (`Dockerfile`)                | `scripts/worker.ts`; owns the pg-boss queue (schema migration, queue creation, cron scheduler, maintenance). Connects through the **direct** connection string. Every email leaves through it.                                                                                 |
| Database          | Neon Postgres, `ap-southeast-2` (Sydney), one branch | The system of record — everything, including the pg-boss job tables (`pgboss` schema), Auth.js sessions, clock-in photos (`bytea`, until `PERF-06` lands) and the audit trail.                                                                                                 |
| Email             | Resend (`EMAIL_TRANSPORT=resend`)                    | Transactional email only; no inbound. Sending happens only from the worker.                                                                                                                                                                                                    |
| DNS / bot gate    | Cloudflare (DNS for `zaleit.com.au`; Turnstile)      | Turnstile guards the public form route; fails closed without `TURNSTILE_SECRET_KEY`.                                                                                                                                                                                           |
| Error tracking    | Sentry-compatible endpoint (`SENTRY_DSN`)            | `src/lib/error-reporting.ts`; fails closed (logs only) when unset.                                                                                                                                                                                                             |
| Owner OAuth       | Google Drive (`drive.file`), Xero Payroll AU         | Tokens encrypted at rest with `TOKEN_ENCRYPTION_KEY`. The FILES live in the owner's Drive and the DRAFT timesheets in Xero — neither is in our database, and neither is ours to restore.                                                                                       |
| CI/CD             | GitHub Actions (`.github/workflows/ci.yml`)          | `build` (tests, coverage ratchet, audit, SBOM) → `migrate-staging` (rehearses pending migrations on the Neon `staging` branch) → `migrate-prod` (applies them to production behind the **`production` Environment approval**). Vercel deploys on push to `main` independently. |

**Single region, deliberately (`OPS-06`).** Web, worker and database all sit
in Sydney. A regional outage of Neon or Vercel is a total outage, and the
recovery time is the provider's. This is the honest posture for an AU-first
product and it stays until a non-AU customer needs otherwise; the first step
then is read replicas and edge assets in-region with writes still homed in
Sydney, and only after that data-residency partitioning.

**What is NOT in the database** (and so is not covered by a database restore):

- Secrets — held in Vercel and Railway environment variables and GitHub
  Actions secrets. See [secrets escrow](#34-secrets-escrow).
- Owners' documents — in their own Google Drive (`staff_document` holds only
  a reference).
- Draft timesheets pushed to Xero — in Xero (`xero_timesheet_push` holds the
  id; the invariant "id non-null ⟺ a live draft" can be re-verified from Xero).
- The code — GitHub.

---

## 2. Service objectives

### 2.1 Recovery objectives

| Objective                   | Target                                                                 | Basis                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RPO** (data we may lose)  | **5 minutes**                                                          | Neon retains WAL for the project's restore window; point-in-time restore lands within seconds of the chosen instant. 5 minutes is the commitment; the drill records the observed gap.  |
| **RTO** (time to be back)   | **4 hours** from declaring a database incident to `/api/ready` = 200   | The drill target is **1 hour**; the published figure leaves room for a 2 am incident and a provider ticket.                                                                            |
| Worker outage (emails stop) | Detected within **5 minutes**, recovered within **30 minutes**         | `/api/ready` reports 503 when the heartbeat is older than 5 min; Railway's `HEALTHCHECK` restarts a wedged container itself. Jobs wait in Postgres — nothing is lost while it is down. |
| Single lost background job  | Visible within **1 minute** of the last retry; re-run in **1 command** | Dead-letter queue + `OPS_ALERT_EMAIL`; `npm run jobs:admin -- retry`.                                                                                                                  |

Why these are defensible: the database is the only stateful component and
Neon's restore is a branch operation, not a file copy — so RPO is bounded by
WAL retention and RTO by how fast a person can act. What would break them:
the restore window being shorter than the time it takes to notice a
corruption (see the configuration record), photo volume inflating the
database (`PERF-06`), or nobody having rehearsed the procedure — which is
what the drill is for.

### 2.2 Service-level objectives (`OPS-01` item 7)

| SLO                          | Target                                                                                          | Measured by                                                                                                                                     | Alert                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Availability                 | **99.9 %** of 1-minute checks per calendar month return 200 from `/api/ready` (≈ 43 min budget) | External uptime monitor on `GET /api/ready` (database up, worker heartbeat < 5 min, oldest due job < 60 min)                                    | Monitor pages on 3 consecutive non-200s                                       |
| Transactional email latency  | **p95 < 5 minutes** from enqueue to sent (availability requests, published rosters, decisions)  | `pgboss.job` `created_on → completed_on` for those queues (`npm run jobs:admin -- stats` for depth; the archive keeps 14 days of finished jobs) | `/api/ready` 503 (`queue: false`) when the oldest DUE job has waited > 60 min |
| Daily sweeps on time         | Every location's digests/reminders dispatched **within 60 minutes** of its local send hour      | `job_dispatch` rows per (kind, business, local date); the hourly `sweep-dispatch` log line (`scanned`, `enqueued`)                              | A tenant's missing row for today after `hour + 1` (see runbook 6.5)           |
| Server error rate            | **< 0.5 %** of server requests report an error                                                  | Error tracker events per request id (`x-request-id`), Vercel function logs                                                                      | Tracker alert rule on the rate                                                |
| Staff clock-in / PIN actions | **p95 < 2 s** server time                                                                       | Vercel function duration for `/kiosk` and `/clock` actions                                                                                      | Vercel/Sentry performance alert                                               |
| Restore readiness            | A **timed restore drill every quarter** completes within RTO                                    | The evidence log in §4.3                                                                                                                        | A missed quarter is a finding                                                 |

Breaching an SLO is not an incident by itself; it opens a review of the
cause and the target. Breaching RTO/RPO during a real incident is a
post-incident-review item (§8).

---

## 3. Backups and point-in-time recovery

### 3.1 What Neon provides

Neon keeps the write-ahead log for the project's **restore window** (Neon:
Project → Settings → Storage → _Restore window_; the plan tier sets the
maximum). Within that window any branch can be restored to any instant, or a
**new branch** can be created from any instant — a copy-on-write branch that
is a full, queryable database in seconds. That branch operation IS our backup
and our restore: there is no nightly dump to manage, and a restore never
overwrites anything until we choose to.

Because the pg-boss tables live in the same database, a point-in-time
restore also restores the queue as it was at that instant (§6.1 covers what
that means for emails).

### 3.2 What we configure and verify

- **Restore window ≥ 7 days.** Long enough that a corruption noticed on a
  Monday (a bad migration merged Friday, an impersonation mistake reported a
  week later) is still restorable. Record the configured value below.
- **A `staging` branch** of production (§5) — also our standing proof that
  branching works.
- **Quarterly restore drill** (§4) and a **monthly automated verification**
  (§4.4).
- **A weekly logical export** is deliberately NOT part of the posture: it
  would add an operational surface (where to put it, who can read the PII in
  it) for a recovery path Neon's branch restore already covers. Revisit if
  Neon is ever the only copy for longer than the restore window allows.

### 3.3 Configuration record

Fill this in from the live Neon/Vercel/Railway/GitHub dashboards. A blank or
stale row means the statement above it is an assumption, not a fact.

| Item                                                        | Value                                               | Checked on | By  |
| ----------------------------------------------------------- | --------------------------------------------------- | ---------- | --- |
| Neon project / region                                       | `roster` / `ap-southeast-2`                         |            |     |
| Restore window configured                                   | _days_ (target ≥ 7)                                 |            |     |
| Neon plan tier (caps the window)                            |                                                     |            |     |
| Production branch name                                      | `production` (Neon default `main` unless renamed)   |            |     |
| Staging branch name                                         | `staging`                                           |            |     |
| Last full restore drill (§4) — date, duration, RPO observed |                                                     |            |     |
| Last monthly verification (§4.4)                            |                                                     |            |     |
| GitHub Environment `production` — required reviewers        |                                                     |            |     |
| Uptime monitor on `/api/ready` — provider, interval         |                                                     |            |     |
| `OPS_ALERT_EMAIL` (dead-letter alerts) set on Railway       | yes / no                                            |            |     |
| `SENTRY_DSN` set on Vercel + Railway                        | yes / no                                            |            |     |
| Neon database roles in use (§6.10)                          | owner (migrations) / `roster_web` / `roster_worker` |            |     |

### 3.4 Secrets escrow

Every secret must exist in **two** places: the platform that uses it and a
password manager vault shared by at least two Zale IT people. The
environment variables and where each is used:

| Secret                                             | Used by                     | Rotation runbook                                             |
| -------------------------------------------------- | --------------------------- | ------------------------------------------------------------ |
| `DATABASE_URL` (pooled), `PROD_DATABASE_URL`       | Vercel; CI                  | §6.8.4                                                       |
| `DATABASE_URL` (direct), `STAGING_DATABASE_URL`    | Railway; CI                 | §6.8.4                                                       |
| `AUTH_SECRET`                                      | Vercel, Railway, CI         | §6.8.1                                                       |
| `TOKEN_ENCRYPTION_KEY`                             | Vercel (Drive/Xero)         | §6.8.2                                                       |
| `RESEND_API_KEY`                                   | Railway (and Vercel if set) | §6.8.3                                                       |
| `GOOGLE_CLIENT_SECRET`, `XERO_CLIENT_SECRET`       | Vercel                      | §6.8.5                                                       |
| `TURNSTILE_SECRET_KEY`                             | Vercel                      | §6.8.5                                                       |
| `PROMPT2EAT_SSO_PUBLIC_KEY`                        | Vercel                      | public key — replace when prompt2eat rotates its private key |
| `SENTRY_DSN`, `OPS_ALERT_EMAIL`, `ADMIN_ALLOWLIST` | Vercel, Railway             | not secrets; keep in the vault for rebuilds                  |

A rebuild of Vercel or Railway from scratch is: create the service, paste the
vault's copy of `.env.vercel.example` / `.env.railway.example` values, deploy.
No secret is derivable from the database.

---

## 4. Restore drill

The drill answers one question with evidence: **can we bring back a
consistent database from a chosen instant, within RTO, without touching
production?** It is run every quarter by someone who did NOT run the previous
one, into a throwaway branch, timed with a stopwatch, and the notes are kept
even when everything works — especially the parts that did not.

### 4.1 Preconditions

- Access to the Neon project, the repository, and a shell with `psql` and
  Node 22.
- A `.env` with the DIRECT connection string of the drill branch (never the
  production branch) — `DATABASE_URL`, plus `AUTH_SECRET=anything` (env
  validation).

### 4.2 Procedure (timed)

1. **T0 — choose the instant.** Pick a timestamp 30–90 minutes in the past
   (`T_restore`). Note the current `max(seq)` of `audit_event` in production:
   the restored copy must have a lower or equal value.
2. **Create a branch from `T_restore`.** Neon → Branches → _Create branch_ →
   parent `production` → _From a point in time_ → `T_restore`. Name it
   `drill-YYYY-MM-DD`. Copy its **direct** connection string. (Stopwatch: how
   long until the branch is ready.)
3. **Sanity queries** against the branch (`psql`):

   ```sql
   select count(*) from business;
   select count(*) from timesheet_entry where deleted_at is null;
   select max(created_at) from audit_event;          -- must be <= T_restore
   select max(created_on) from pgboss.job;           -- the queue came with it
   select count(*) from "session" where expires > now();
   ```

   The `max(created_at)` line is the **observed RPO**: the gap between
   `T_restore` and the newest row is how much a real restore to `T_restore`
   would have lost relative to that instant (expect seconds).

4. **Run the migrations against the branch.** `npm run db:migrate` with the
   branch URL. A restore to an instant BEFORE a migration was applied must
   still accept the current code's migrations cleanly — this is the step
   that finds a migration nobody made re-runnable.
5. **Verify the audit chain on the branch.** Sign in to a local `npm run dev`
   pointed at the branch (`DATABASE_URL`, `AUTH_SECRET`, `EMAIL_TRANSPORT=smtp`
   with Mailpit for the magic link), open Settings → Account → _Recent
   changes_ (`/app/activity`), and confirm the chain verdict is intact for at
   least one business. A broken chain on a clean restore means the restore
   itself is inconsistent — stop and investigate.
6. **Exercise one write path.** Clock a test staff member in and out on the
   local app against the branch; confirm the entry and its audit event
   appear. (Proves the schema, the app and the data agree.)
7. **Rehearse the promotion step WITHOUT doing it.** Read §6.1 steps 5–8 out
   loud with the Neon console open, identify the exact buttons and the exact
   connection strings you would change. Do not change them.
8. **Stop the stopwatch.** Record the timings and the observations in §4.3.
9. **Delete the drill branch** (it holds production PII).

### 4.3 Evidence template

Copy into the drill log (`docs/drills/YYYY-MM-DD.md`, or the ops wiki) and
into the configuration record.

```
Restore drill — YYYY-MM-DD
Operator:                      (name; not the previous drill's operator)
Instant restored (T_restore):  YYYY-MM-DDTHH:MM:SSZ
Branch ready after:            m:ss
Sanity queries done at:        m:ss   observed RPO: N s (max(created_at) vs T_restore)
Migrations applied at:         m:ss   (pending migrations: N; any failure?)
Audit chain verdict:           intact / broken (business …)
Write-path check:              ok / failed (…)
Promotion rehearsal:           steps understood; strings identified: yes/no
Total elapsed:                 m:ss   (target ≤ 1 h; RTO 4 h)
What broke or surprised us:    …
Follow-ups (issue links):      …
Drill branch deleted:          yes
```

### 4.4 Monthly automated verification

Between drills, once a month, a lighter check proves the branch path still
works: create a branch from "1 hour ago", run the three count queries from
step 3 through `psql`, compare with production, delete the branch. Script it
with the Neon CLI (`neonctl branches create --parent production --timestamp …`)
and keep the output with the drill log. If the counts differ by more than the
last hour's activity, or the branch takes more than 10 minutes to become
queryable, raise it as a finding.

---

## 5. Staging and the migration gate

Two pipeline changes put a rehearsal and a human between a merged migration
and production (`OPS-03` items 4–5):

1. **`migrate-staging`** runs on every push to `main`, after `build`, and
   applies the pending migrations to the **Neon `staging` branch** (a
   copy-on-write child of production). It **fails closed**: with no
   `STAGING_DATABASE_URL` secret it stops with a message naming this section,
   and production is not migrated.
2. **`migrate-prod`** needs `migrate-staging` and runs inside the GitHub
   **Environment `production`**, which is configured with **required
   reviewers**. GitHub holds the job until a reviewer approves it; the
   approval is recorded on the run.

### 5.1 One-time setup

1. **Neon:** Branches → _Create branch_ → parent `production` → name
   `staging`. Copy the DIRECT connection string.
2. **GitHub → Settings → Environments:**
   - `staging` — add secret `STAGING_DATABASE_URL` (the branch's direct
     string). No reviewers.
   - `production` — _Required reviewers_: at least two Zale IT engineers
     (any one approves). _Deployment branches_: `main` only. Move
     `PROD_DATABASE_URL` and `AUTH_SECRET` here from the repository secrets
     (repository secrets still work if you leave them; environment secrets
     are simply scoped tighter).
3. **Reset staging from production** monthly and before any migration that
   rewrites data (Neon → Branches → `staging` → _Reset from parent_), so the
   rehearsal runs against the current schema and data shape.

Staging holds a copy of production data. It has the same access rules as
production and is deleted/reset, never shared.

### 5.2 Deploy order (read before merging a schema change)

Vercel deploys the new code the moment `main` moves; the migration waits for
CI and an approval. For an **additive** migration this is safe only if the
new code tolerates the old schema for the minutes in between. When the new
code reads a new column or table on a hot page, either:

- **apply the migration first** — run `npm run db:migrate` by hand against
  production BEFORE merging (README → Production deployment → step 1), then
  merge; the CI job then finds nothing pending; or
- **approve immediately** — have a reviewer ready at merge time.

A failed `migrate-prod` run applies **nothing**: Drizzle runs all pending
migrations in one transaction, so the schema is either fully moved or
untouched. Re-running the job (or `npm run db:migrate` by hand) is always
safe — applied migrations are skipped.

### 5.3 Destructive migrations — expand / contract, by hand

`migrate-prod` is for **additive** migrations only. Dropping, renaming or
retyping a column or table is done by hand in three releases:

1. **Expand** — add the new column/table (via the pipeline). Deploy code that
   writes BOTH old and new and reads new-with-fallback.
2. **Migrate + verify** — backfill with a resumable script (batched, keyset
   paginated, idempotent). Verify counts match. Switch reads to the new shape.
3. **Contract** — only after every reader is on the new shape AND the restore
   window has passed since the last write to the old column (so any restore
   during the window still works with the deployed code): run the `DROP` by
   hand against `staging` first, then production, in a maintenance window,
   with the exact statement pasted into the change record.

Worked example — the `clock_photo.image_data` `bytea` column (`PERF-06`):
expand adds `storage_key`/`content_length`/`checksum` and dual-writes; the
backfill copies rows to the blob store; reads prefer `storage_key`; contract
drops `image_data` only after the longest photo retention (90 days) plus the
restore window has elapsed.

### 5.4 Pre-building a large index

Migrations are written `CREATE INDEX IF NOT EXISTS` so an operator can build a
big index outside the transactional runner first:

```sql
create index concurrently if not exists <name> on <table> (...);
```

Then the pipeline's migration is a no-op for that statement.

---

## 6. Runbooks

Each runbook: **symptoms → decide → act → verify → afterwards.** Log every
step with times in the incident channel as you go; the post-incident review
(§8) is written from that log.

### 6.1 Database restore (point-in-time)

**Symptoms:** data missing or wrong for many tenants at once; a migration or
an operator statement did damage; Neon reports branch corruption. (One
tenant's own mistake is NOT a restore — it is the audit trail + owner
support; see §6.11.)

**Decide:** the restore instant `T_restore` — the last moment the data was
known good. The audit trail (`audit_event.created_at` per business) and
`admin_activity` narrow it down. Every write after `T_restore` will be lost
for everyone; write the instant and the reason in the channel BEFORE acting.

**Act:**

1. **Freeze writes.** Railway → worker → _Remove/scale to 0_ (jobs will wait).
   Vercel → the project → _Deployments_ → note the current deployment. Put the
   web app in maintenance if you can (rollback to a deployment that shows a
   static page, or Vercel's deployment protection); otherwise proceed quickly
   — every minute of writes after the freeze is lost data.
2. **Branch from the instant**, exactly as in the drill (§4.2 step 2). Name it
   `restore-YYYY-MM-DD-HHMM`.
3. **Sanity-check the branch** (§4.2 step 3). Confirm the damage is absent.
4. **Migrate the branch** (`npm run db:migrate` with the branch's direct URL)
   if the running code is newer than the schema at `T_restore`.
5. **Promote.** Two options; the first keeps production's history in place:
   - _Neon restore:_ Branches → `production` → _Restore_ → from
     `restore-…` (Neon keeps the pre-restore state as a backup branch,
     `production_old_…`). Connection strings do not change.
   - _Swap strings:_ update `DATABASE_URL` on Vercel (pooled) and Railway
     (direct), and `PROD_DATABASE_URL` in GitHub, to the new branch; redeploy
     Vercel; rename branches afterwards so `production` points at what is
     live.
6. **Restart the worker** (scale back to 1). Watch its logs for
   `Workers registered` and the first heartbeat.
7. **Verify:** `GET /api/ready` → 200 with `worker: true`; sign in; open a
   business's `/app/activity` and confirm the chain verdict is intact; open a
   timesheet.
8. **Queue replay.** The restored `pgboss.job` table holds whatever was
   queued at `T_restore`. Jobs completed between `T_restore` and the freeze
   will run AGAIN. Every handler is idempotent through its own cursor
   (`sent_at`, `decision_notified_at`, `last_reminder_stage`,
   `form_digest_last_at`, `dedupe_key`) — but those cursors were also rolled
   back, so an email sent in that window WILL be sent a second time. That is
   the accepted cost; note the window in the incident log so support can
   answer "why did I get this twice". If the window is long, cancel the
   queued roster/availability emails before restarting the worker:

   ```sql
   -- inspect first
   select name, state, count(*) from pgboss.job where state in ('created','retry') group by 1,2;
   -- cancel a queue's pending jobs (they stay visible as cancelled)
   update pgboss.job set state = 'cancelled', completed_on = now()
    where name = 'availability-reminder' and state in ('created','retry');
   ```

**Afterwards:** keep the pre-restore branch for the full restore window
(evidence, and the source for any per-tenant salvage — a row lost in the
window can be copied back by hand from it). Post-incident review within 5
working days. Update the configuration record with the real timings.

### 6.2 Bad migration

**Symptoms:** `migrate-prod` red; or green but the app errors after deploy
(check the error tracker for the request ids); or a data change nobody
intended.

**Act:**

- **Red job, nothing applied** (the normal failure): the run's log names the
  statement. Fix forward — a new migration or a corrected one on a branch,
  rehearsed on `staging` (§5.1 step 3 to reset it), then merge and approve.
  Do NOT edit an already-merged migration file that CI might have applied
  elsewhere.
- **Applied and wrong, data intact:** fix forward with a corrective
  migration. If the new code cannot run against the applied schema, roll
  Vercel back to the previous deployment (Vercel → Deployments → _Promote_)
  while the fix is prepared.
- **Applied and destroyed data:** this is §6.1 with `T_restore` = just
  before the migration ran (the run's timestamp is on the Actions page).

**Verify:** `/api/ready` 200; the error tracker quiet; the audit chain intact.

### 6.3 Worker outage

**Symptoms:** `/api/ready` → 503 with `worker: false`; owners report emails
not arriving; Railway shows the service crashed or restarting.

**Act:**

1. Railway → the worker → _Logs_. The last lines before the crash name the
   cause (a job that throws on every attempt is retried, not crashing —
   look for `unhandledRejection`, a DB connection error, or an env
   validation error after a variable change).
2. Env change? Every variable in `.env.railway.example` must be set; the
   worker validates the whole env at boot and refuses to start otherwise.
3. Database reachable from the worker? Must be the **direct** Neon string
   (no `-pooler`); pg-boss needs session mode.
4. Restart the service. Confirm `Workers registered` and `Worker started`.
5. If it crash-loops on boot at `createQueue`/`schedule`, the `pgboss` schema
   may be mid-migration from a previous pg-boss version; check the log line
   and, if needed, run the worker once with a shell attached to read the
   full error.

**Verify:** `/api/ready` 200 (`worker: true`); `npm run jobs:admin -- stats`
shows queued counts falling; `queue: true`.

**Afterwards:** nothing to replay — jobs waited in Postgres. A backlog of
daily digests will drain within the hour (bounded concurrency, 4 per
worker).

### 6.4 Queue backlog, stuck or failed jobs

**Symptoms:** `/api/ready` → 503 with `queue: false` (`queueBacklogMs` over
an hour) while `worker: true`; a dead-letter alert email; an owner says one
specific email never came.

**Act:**

```bash
# depth per queue
npm run jobs:admin -- stats
# jobs that exhausted their retries, newest first, payloads sanitised
npm run jobs:admin -- failed --limit 50
# fix the cause (Resend key, a bad row, a bug), then re-run one job in place
npm run jobs:admin -- retry --queue published-roster --id <job id>
```

`retry` puts the failed job back to `retry` in its own queue with the same
id and singleton key and one more attempt — the handler's idempotency cursor
still protects against double sends. Re-running is safe for every queue.

A backlog with nothing failed means the worker is alive but slow: a long
job holding the single worker (a huge tenant's sweep), or the database being
slow. Read the worker's per-job duration lines; scale the worker's
`localConcurrency` only after understanding why.

**Verify:** the failed list is empty or explained; `queue: true`.

### 6.5 Re-send one tenant's daily digests

**Symptoms:** a location's owner did not get today's certification/order/
form digest, or staff did not get the "you work tomorrow" notice, and the
cause (a bad row, a bug, a Resend hiccup) is fixed.

**Act:**

```bash
# What already ran today for this business is in the ledger:
#   select * from job_dispatch where business_id = '<id>' order by enqueued_at;
# Re-run the dispatcher for ONE business, clearing today's claims first:
npm run jobs:admin -- redispatch --business <business id> --force
```

Without `--force` the command enqueues only sweeps not yet dispatched for
the business's local date (the normal catch-up); with it, every sweep whose
send hour has passed runs again. Each per-business handler is idempotent
through its cursor, so re-running a digest that DID send is a no-op; only a
digest that failed before its cursor advanced sends now.

### 6.6 Resend (email provider) outage

**Symptoms:** worker logs show Resend errors on every email job; jobs move to
`retry` with backoff, then to `failed` after 5 attempts; a dead-letter alert
(which itself may fail to send — it is also email — and is then logged and
reported to the tracker instead).

**Act:**

1. Confirm on Resend's status page / dashboard (sending limits, a suspended
   domain, an expired API key).
2. **Do nothing to the queue while the outage lasts** — retries with
   exponential backoff span roughly an hour; most short outages resolve
   inside that.
3. If the outage outlasts the retries: once Resend is back, `npm run
jobs:admin -- failed` and `retry` each job. The availability magic-link
   token travels in the job payload, so a retried availability request sends
   the ORIGINAL link — nothing needs re-generating.
4. Key rotated by Resend or by us: §6.8.3, then retry.

**Verify:** a test availability request arrives; the failed list is empty.

### 6.7 OAuth mass-revocation (Xero, Google Drive)

**Symptoms:** many `xero_connection.needs_reconnect` / `google_drive_connection.needs_reconnect`
flip to true at once; owners report "reconnect" prompts; a provider notice
(client secret rotated, app suspended, consent screen re-verification).

**Act:**

1. Scope:

   ```sql
   select count(*) filter (where needs_reconnect) as broken, count(*) as total from xero_connection;
   select count(*) filter (where needs_reconnect) as broken, count(*) as total from google_drive_connection;
   ```

2. Cause on the provider side (Xero developer portal / Google Cloud
   Console): a rotated client secret must be updated in Vercel
   (`XERO_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`); a suspended app must be
   re-verified with the provider.
3. Nothing is restored from our side: the app never mints provider tokens.
   Each owner reconnects from Settings (Xero → _Reconnect_, confirm the org
   name again; Drive → _Reconnect_). Draft timesheets already in Xero and
   files already in Drive are unaffected.
4. Communicate: an in-app banner already shows per affected owner; for a
   mass event send one email to the affected owners (list from the queries
   above joined to `ownerEmailsForBusiness`).

**Verify:** the `broken` counts fall as owners reconnect; a test push to a
demo Xero org succeeds.

### 6.8 Secret rotation

General rule: rotate in the platform that USES the secret first, the vault
second, and never leave a secret set in only one place. Rotation is a
deploy on Vercel (new env → redeploy) and a restart on Railway.

#### 6.8.1 `AUTH_SECRET`

Signs: Auth.js CSRF and email-verification tokens, the staff notices PIN
proof (15 min), and the admin impersonation grant (30 min). **Does not
sign owner sessions** — sessions are database rows looked up by an opaque
cookie, so signed-in owners stay signed in. Rotating invalidates: magic
links already emailed but not yet clicked (owners request a new one), any
notices proof (staff re-enter their PIN), any impersonation grant (the admin
re-enters from the console).

1. Generate: `npx auth secret` (or 32 random bytes, base64).
2. Set the SAME value on Vercel and Railway (the worker validates env; it
   does not use the secret) and in `AUTH_SECRET` for the GitHub `production`
   environment.
3. Redeploy Vercel; restart the worker.
4. Verify: request a magic link, sign in; open `/me` with a PIN.

Rotate at least yearly and immediately on suspected exposure.

#### 6.8.2 `TOKEN_ENCRYPTION_KEY`

Encrypts the Xero and Google Drive OAuth tokens at rest (AES-256-GCM,
`v1.<iv>.<tag>.<ct>`, `src/lib/crypto.ts`). **The envelope carries no key
id (`SEC-13`), so rotation is a hard cutover: every stored token becomes
undecryptable and every connected owner must reconnect.** Until a key ring
(`v2.<keyId>…` + accepted keys + a re-encrypt job) exists, treat rotation as
an incident procedure, not maintenance:

1. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. Set it on Vercel; redeploy.
3. Flip every connection to "needs reconnect" so the UI prompts instead of
   failing on a decrypt error:

   ```sql
   update xero_connection set needs_reconnect = true;
   update google_drive_connection set needs_reconnect = true;
   ```

4. Email the affected owners (§6.7 step 4).
5. Verify: a reconnect stores a token the new key decrypts (a test push /
   upload works).

If a compromise is suspected, ALSO revoke the tokens at the providers
(Xero: disconnect the app from each org; Google: the app's access from the
account) — rotating our key does not invalidate a token an attacker already
decrypted.

#### 6.8.3 `RESEND_API_KEY`

1. Resend dashboard → API keys → create a new key (sending access, same
   domain). 2. Set on Railway (and Vercel if present); restart the worker. 3. Send a test availability request; confirm delivery. 4. Delete the old
   key in Resend. Failed sends during the swap land in `failed` — `retry`
   them (§6.4).

#### 6.8.4 Database password / connection strings

1. Neon → Roles → reset the password for the app role(s). Neon issues new
   connection strings.
2. Update `DATABASE_URL` on Vercel (pooled) and Railway (direct),
   `PROD_DATABASE_URL` and `STAGING_DATABASE_URL` in GitHub.
3. Redeploy Vercel; restart the worker; run one migration job on staging to
   prove CI's copy works.
4. Verify `/api/ready` 200.

Neon holds the credential; a reset takes effect immediately, so do steps
1–3 within one sitting.

#### 6.8.5 Provider client secrets and Turnstile

`GOOGLE_CLIENT_SECRET`, `XERO_CLIENT_SECRET`: rotate at the provider, set on
Vercel, redeploy. Existing owner tokens keep working (the client secret
authenticates the APP for new exchanges and refreshes); a refresh that fails
during the swap marks that connection `needs_reconnect`, which the owner
clears by reconnecting. `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY`:
rotate as a pair in Cloudflare; between the deploy and the key going live
public form submissions are refused (fail closed), so do it in a quiet
hour.

### 6.9 Suspected key or credential compromise

Order matters — cut the attacker's access first, then clean up:

1. **Database credential:** §6.8.4 immediately. Then `select * from
audit_event where created_at > <suspected time> order by seq` per business
   and `admin_activity` for anything unexplained; the hash chain
   (`/app/activity`) tells you whether rows were altered.
2. **`AUTH_SECRET`:** §6.8.1. Also delete all sessions to force re-login:
   `delete from "session";` (owners sign in again by magic link).
3. **`TOKEN_ENCRYPTION_KEY`:** §6.8.2 including provider-side revocation.
4. **Admin console:** revoke any suspect `platform_admin` row — deleting the
   row ends that admin's impersonation grants on their next request
   (`resolveImpersonation` re-checks the row every time).
5. Notify affected customers per the privacy obligations (OAIC notifiable
   data breach assessment within 30 days if personal information was likely
   accessed).

### 6.10 Audit trail integrity — grant-level protection

The application never `UPDATE`s or `DELETE`s `audit_event` except the
seven-year retention sweep, and the per-scope hash chain makes any later
edit detectable (`getAuditChainStatus`, surfaced on `/app/activity`). To make
it **impossible** rather than detectable, the application must not connect
as the table's owner. Run once as the Neon project owner (adapt the role
names; the owner role stays the one CI migrates with):

```sql
-- Two application roles: the web app (no UPDATE/DELETE on the trail) and the
-- worker (DELETE only, for the retention policy; never UPDATE).
create role roster_web    login password '<from the vault>';
create role roster_worker login password '<from the vault>';

grant usage on schema public to roster_web, roster_worker;
grant select, insert, update, delete on all tables in schema public to roster_web, roster_worker;
grant usage, select on all sequences in schema public to roster_web, roster_worker;
alter default privileges in schema public grant select, insert, update, delete on tables to roster_web, roster_worker;
alter default privileges in schema public grant usage, select on sequences to roster_web, roster_worker;

-- The trail is append-only for the app.
revoke update, delete on audit_event from roster_web;
revoke update on audit_event from roster_worker;

-- pg-boss: the worker owns the pgboss schema (it runs pg-boss's own
-- migrations at boot); the web app only inserts jobs.
grant create on database <db> to roster_worker;
-- after the worker's first boot with the new role:
grant usage on schema pgboss to roster_web;
grant select, insert, update on all tables in schema pgboss to roster_web;
```

Then set Vercel's `DATABASE_URL` to `roster_web`'s pooled string, Railway's to
`roster_worker`'s direct string, and keep `PROD_DATABASE_URL` (CI migrations)
on the owner role. Record it in §3.3. Verify with `psql` as `roster_web`:

```sql
update audit_event set outcome = 'ok' where false;   -- ERROR: permission denied
```

**If the chain verdict is ever "broken":** treat it as a security incident
(§6.9 step 1). The verdict names the first altered or missing row; the
pre-restore branch or a point-in-time branch (§6.1 step 2) from before that
row's `created_at` holds the original for comparison.

### 6.11 One tenant's data mistake (not a restore)

An owner deleted a staff member, edited the wrong timesheet, or an admin
changed something while impersonating. The trail has the BEFORE snapshot for
the records that matter (timesheet entries, staff, settings, offers, leave,
certs, items, pay rules): `select before, after from audit_event where
business_id = … and entity = … and entity_id = … order by seq`. Timesheet
entries are soft-deleted and restorable from the Timesheets page (Undo).
Anything else is re-entered by the owner from the snapshot; if a point-in-time
copy is needed to read a row that had no snapshot, create a branch (§4.2 step 2) and query it — never restore production for one tenant.

### 6.13 Moving clock-in photos to object storage (PERF-06 rollout)

The expand step shipped in code (`clock_photo.storage_key` + size + checksum,
`image_data` nullable, migration `0044`). The rest is an operator sequence —
each step is safe to pause on and to repeat:

1. **Bucket + key.** Create a private bucket (S3 / R2 / MinIO); a key with
   `GetObject`, `PutObject`, `DeleteObject`, `HeadObject` on that bucket
   ONLY; a lifecycle rule expiring objects older than **120 days** (the
   longest photo retention is 90 days, so any older object is an orphan —
   this rule is the backstop for a delete that failed permanently).
2. **Configure** `BLOB_S3_*` on Vercel AND Railway (`.env.*.example`), deploy
   / restart. New photos now go to the store **and** the database (`dual`);
   reads prefer the store. Verify: clock in on a kiosk with photos on, open
   the photo from Timesheets, confirm the object in the bucket and
   `storage_key` set on the row. Rollback at this point = unset the variables.
3. **Backfill history:** `npm run photos:backfill` (direct `DATABASE_URL`;
   add `--business <id>` to do one tenant, `--limit N` to bound a run). It
   is resumable and idempotent — re-run until it reports `scanned 0`. A
   non-zero `failed` count means a store error; the rows stay eligible.
4. **Flip the flag** `photo_blob_only` on `/admin/flags` — one client first,
   then everyone. New photos now skip the database. Rollback = flag off (a
   photo written store-only stays readable through the store).
5. **After the rollback window** (a full retention cycle, ≤ 90 days, is the
   conservative choice; a week is enough once step 4 has held):
   `npm run photos:backfill -- --clear-bytes`. Each row's object is
   `HEAD`-verified against the recorded size before its database copy is
   dropped; a mismatch is kept and logged. Repeat until `cleared 0`.
6. **Contract** (manual, §5.3): once `select count(*) from clock_photo where
image_data is not null` is 0 on `staging` and production —
   ```sql
   alter table clock_photo drop constraint clock_photo_bytes_or_key_check;
   alter table clock_photo drop column image_data;
   ```
   then remove the `imageData` column from the schema, the `database`/`dual`
   write modes and the flag in the same PR, and `VACUUM (FULL)` or let
   autovacuum reclaim the space.

Invariants that hold throughout: a store outage never blocks clocking (the
bytes go to the database that once, and the tracker gets a `clock-photo`
event); photos are always served through the owner's session, never a bucket
URL; retention deletes the object BEFORE the row and keeps a row whose object
would not go.

### 6.12 Provider or region outage

Neon, Vercel or Railway down in Sydney: confirm on the provider's status
page, post the status in the incident channel, and set an owner-facing
notice if the app can serve one. There is no failover (`OPS-06`); the RTO is
the provider's. When the database returns, `/api/ready` recovers on its own
and the worker drains its backlog (§6.3 afterwards).

---

## 7. Monitoring and alert routing

| Signal                                       | Source                                                        | Meaning                                                                                                                                  | Who is paged                    |
| -------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `GET /api/ready` non-200                     | External uptime monitor, 1-minute interval                    | Body names the check: `database` (Neon down/unreachable), `worker` (no heartbeat for 5 min), `queue` (a due job has waited over an hour) | On-call, immediately            |
| Dead-letter alert email                      | Worker → `OPS_ALERT_EMAIL`                                    | One job exhausted its retries; the email names the source queue, the sanitised payload and the last error                                | On-call, next working hour      |
| Error tracker event                          | `SENTRY_DSN` (web via `onRequestError`; worker via `guarded`) | Each event carries the request id (`x-request-id`) and the `digest` the owner sees on the branded error page                             | On-call at rate threshold       |
| Railway `HEALTHCHECK` failing                | Container                                                     | The worker's heartbeat file is stale → Railway restarts it                                                                               | Nobody (self-healing); log only |
| `Sweep dispatch complete` log line, hourly   | Worker logs                                                   | `scanned`/`enqueued` counts per kind; a tick with `scanned: 0` in a busy hour is wrong                                                   | Reviewed weekly                 |
| `Business sweep skipped` / `zero recipients` | Worker logs (`logger.warn`)                                   | A location with no owner membership — a data problem, not a bug                                                                          | Reviewed weekly                 |
| `/app/activity` chain verdict                | Owner UI                                                      | "Intact" per business; anything else is §6.10                                                                                            | On report                       |

Owner-visible error pages show a **reference code** — it is the `digest` in
the tracker and the log line; ask for it in every support conversation.

---

## 8. Incident response

**Severity:** S1 — data loss/corruption, security breach, or the app or all
email down for everyone (page now; RTO/RPO apply). S2 — a feature broken for
many tenants, emails delayed beyond the SLO, one integration down (same
working day). S3 — one tenant affected, cosmetic, or a monitoring blip (next
working day).

**During:** one person coordinates and keeps the timestamped log in the
incident channel; one person acts. Announce the decision (restore instant,
freeze) before acting on it. For S1 involving personal information, start the
notifiable-data-breach assessment in parallel.

**Post-incident review** (within 5 working days for S1/S2), one page:

```
Incident:      title, severity, start → detect → mitigate → resolve (times)
Impact:        tenants/users affected, data lost (RPO observed), duration (RTO observed)
Timeline:      from the channel log
Cause:         what actually happened (not who)
What worked:   which signal caught it, which runbook step held
What didn't:   missing alert, wrong runbook step, slow decision
Actions:       owner + date each; runbook edits land in this file in the same PR
```

---

## 9. Change log

| Date       | Change                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-05 | Initial runbook (audit `OPS-03`): RTO/RPO, SLOs, PITR posture, restore drill + evidence template, staging + `production` approval gate, runbooks 6.1–6.12, `jobs:admin` CLI. |
