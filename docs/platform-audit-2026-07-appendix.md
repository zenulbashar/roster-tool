# Platform Audit — Remediation Appendix

Companion to [`platform-audit-2026-07.md`](./platform-audit-2026-07.md). Ready-to-apply snippets for
the Phase 0 milestones. Each is scoped to one finding and is backward compatible unless noted.

> These are drafted from a read of the codebase, not from a running system. Review, adapt to local
> conventions, and verify against staging before production.

---

## A1 — `SEC-01`: bind the impersonation grant to the live session

**File:** `src/lib/admin/impersonation-session.ts`

The grant currently validates the cookie in isolation, so it works with no signed-in session at all.
Add the session check inside `resolveImpersonation` — putting it here rather than in `requireOwner`
means every present and future caller inherits the fix.

```ts
import { auth } from "@/lib/auth";

export async function resolveImpersonation(): Promise<ActiveImpersonation | null> {
  const store = await cookies();
  const raw = store.get(IMPERSONATION_COOKIE)?.value;
  const claims = parseImpersonationToken(raw, env.AUTH_SECRET);
  if (!claims) return null;

  // The grant is an attribute of an authenticated admin session, NOT a bearer
  // token. Without this check a leaked cookie alone grants 2h of full read/write
  // on a client's live account, and sign-out does not end it.
  const session = await auth();
  if (session?.user?.id !== claims.adminUserId) return null;

  if (!(await isPlatformAdmin(claims.adminUserId))) return null;
  // …unchanged: re-check the bound location still belongs to the bound org
}
```

**Note on import direction.** `isPlatformAdmin` was deliberately placed in
`src/lib/admin/repository.ts` so this module carried no Auth.js import (see its docstring). That
constraint is now traded for correctness. If the NextAuth import causes a cycle or bloats the worker
bundle, inject the session resolver instead:

```ts
export async function resolveImpersonation(
  getSession: () => Promise<{ user?: { id?: string } } | null> = auth,
): Promise<ActiveImpersonation | null>;
```

**Also required — clear the cookie on sign-out.** `src/app/app/layout.tsx:38`:

```ts
async function signOutAction() {
  "use server";
  await clearImpersonationCookie(); // must precede signOut(); signOut() redirects
  await signOut({ redirectTo: "/" });
}
```

Do the same on the sign-in path so a new session never inherits a prior grant.

**Tests**

```ts
it("rejects a valid impersonation cookie with no session", …);
it("rejects a valid cookie presented by a different signed-in user", …);
it("clears the impersonation cookie on sign-out", …);
it("still resolves for the bound admin's own session", …);
```

---

## A2 — `PERF-01`: index pack

**⚠️ Do not put this in a Drizzle migration.** `CREATE INDEX CONCURRENTLY` cannot run inside a
transaction, and the `migrate-prod` job wraps migrations. Run it as a one-off maintenance script, or
split each statement into its own non-transactional migration.

```sql
-- roster_assignment: the largest table in the system, currently indexed ONLY by
-- the (shift_id, staff_member_id) unique constraint. Both predicates below are
-- used on hot paths and neither can use that index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS roster_assignment_business_idx
  ON roster_assignment (business_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS roster_assignment_staff_idx
  ON roster_assignment (staff_member_id);

-- shift: only (roster_period_id) exists. (business_id, date) is the predicate for
-- clock-in matching, overlap detection and every date-ranged read.
CREATE INDEX CONCURRENTLY IF NOT EXISTS shift_business_date_idx
  ON shift (business_id, date);

-- availability_response: no business_id or shift_id index at all today.
CREATE INDEX CONCURRENTLY IF NOT EXISTS availability_response_business_shift_idx
  ON availability_response (business_id, shift_id);

-- timesheet_entry: (business_id, staff_member_id) exists but every heavy read
-- filters business_id + a clock_in_at RANGE (timesheets view, CSV export,
-- labour report, Xero push).
CREATE INDEX CONCURRENTLY IF NOT EXISTS timesheet_entry_business_clockin_idx
  ON timesheet_entry (business_id, clock_in_at);

-- Tables with no business_id index at all.
CREATE INDEX CONCURRENTLY IF NOT EXISTS roster_period_business_idx
  ON roster_period (business_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS shift_template_business_idx
  ON shift_template (business_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS published_roster_business_idx
  ON published_roster (business_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS admin_activity_business_idx
  ON admin_activity (business_id);

-- clock_photo: the retention delete and per-entry lookups scan a table of BLOBs.
CREATE INDEX CONCURRENTLY IF NOT EXISTS clock_photo_entry_idx
  ON clock_photo (timesheet_entry_id);

-- form_rate_limit: needed to make the PERF-10 sweeper cheap.
CREATE INDEX CONCURRENTLY IF NOT EXISTS form_rate_limit_expires_idx
  ON form_rate_limit (expires_at);

-- staff_loan_active_idx is a plain index on a boolean (useless selectivity).
DROP INDEX CONCURRENTLY IF EXISTS staff_loan_active_idx;
CREATE INDEX CONCURRENTLY IF NOT EXISTS staff_loan_active_partial_idx
  ON staff_loan (to_business_id, staff_member_id) WHERE active;
```

**Keep the Drizzle schema in sync** so `db:generate` does not try to re-create these — add matching
`index(...)` entries to the table definitions in `src/lib/db/schema.ts` and verify
`drizzle-kit generate` produces an empty diff afterwards.

**Verify, do not assume.** For each of the nine paths, confirm the plan changed:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT … -- listAssignments, listResponses, listEntriesForLabourReport, etc.
```

Look for `Index Scan` replacing `Seq Scan`, and compare `shared read` blocks before/after.

---

## A3 — `SEC-05` / `SEC-08`: security headers and indexing controls

**File:** `next.config.ts`

```ts
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    // camera: kiosk clock-in photos. geolocation: personal-phone GPS clock-in.
    // Everything else denied.
    key: "Permissions-Policy",
    value: "camera=(self), geolocation=(self), microphone=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  // …existing config unchanged
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Public capability pages: staff names + shift times (/r) and public
        // forms (/f). Slug entropy is the only access control, so they must
        // never be indexed and must not leak via Referer.
        source: "/:prefix(r|f)/:slug*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};
```

**CSP — start in report-only.** Likely violations: inline styles, the Google Fonts links in
`src/app/layout.tsx`, and the Turnstile script. Two weeks of reports, then enforce.

```ts
{
  key: "Content-Security-Policy-Report-Only",
  value: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",           // clock photos are served as bytes
    "frame-src https://challenges.cloudflare.com",
    "connect-src 'self'",
    "frame-ancestors 'none'",               // impersonation safety is visual
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
}
```

Replace `'unsafe-inline'` on `script-src` with a nonce before enforcing; `img-src blob:` is needed
by the kiosk webcam capture, and `data:` by the QR renderer.

**`src/app/robots.ts`**

```ts
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: [
          "/app",
          "/admin",
          "/kiosk",
          "/clock",
          "/me",
          "/r",
          "/f",
          "/a",
        ],
      },
    ],
  };
}
```

**Test** — assert the header set so it cannot silently regress:

```ts
it("serves HSTS, nosniff, referrer and permissions headers on every route", …);
it("serves noindex on /r/* and /f/*", …);
```

---

## A4 — `COR-01`: org-aware owner resolution in background jobs

**File:** `src/lib/jobs/handlers.ts` — replaces the identical block at three sites (`:465`, `:562`,
`:784`).

The current query uses `users.businessId`, which is written once at onboarding
(`src/app/onboarding/page.tsx:68`) and never updated by `addLocationAction`. Every location except
the owner's first therefore resolves to zero recipients and is skipped by `continue`.

```ts
/**
 * Email addresses to notify for a location. Resolves through the M29 ownership
 * edge (business → org → org_membership → user), NOT the legacy
 * `users.business_id` pointer, which is only ever set to the owner's FIRST
 * location and silently skipped every other location's reminders.
 */
async function ownerEmailsForBusiness(businessId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(orgMemberships)
    .innerJoin(users, eq(users.id, orgMemberships.userId))
    .innerJoin(businesses, eq(businesses.orgId, orgMemberships.orgId))
    .where(
      and(eq(businesses.id, businessId), eq(orgMemberships.role, "owner")),
    );
  return rows.map((r) => r.email).filter(Boolean);
}
```

At each call site, replace the inline lookup and make the empty case visible — a tenant with no
reachable owner is an operational anomaly, not a no-op:

```ts
const ownerEmails = await ownerEmailsForBusiness(biz.id);
if (ownerEmails.length === 0) {
  logger.warn(
    { businessId: biz.id },
    "No owner recipient for business; skipping",
  );
  continue;
}
```

**Tests** — the existing suite passes because fixtures are single-location:

```ts
it("emails cert reminders for a SECOND location in the same org", …);
it("emails order reminders for a second location", …);
it("sends the form digest for a second location", …);
it("warns when a business has no reachable owner", …);
```

---

## A5 — `PERF-08`: connection pool and query timeouts

**File:** `src/lib/db/index.ts`

Currently `new Pool({ connectionString })` — no ceiling, and crucially **no `statement_timeout`**, so
one pathological query holds a connection until the platform kills the request.

```ts
const isWorker = process.env.ROSTER_ROLE === "worker";

const pool =
  globalForDb.__rosterPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    // Serverless: many short-lived instances, so keep each pool small.
    // The worker is one long-lived process and can hold more.
    max: isWorker ? 10 : 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: isWorker ? "roster-worker" : "roster-web",
    // Bound the blast radius of a slow query. Reports and the labour aggregation
    // are the paths most likely to approach the web limit — measure before
    // lowering further.
    statement_timeout: isWorker ? 60_000 : 10_000,
    idle_in_transaction_session_timeout: 15_000,
  });
```

Set `ROSTER_ROLE=worker` in the Railway service env (add it to `.env.railway.example`). Note the
worker needs the **direct** (session-mode) Neon connection for pg-boss, as the README already
documents.

---

## A6 — `OPS-01`: health, readiness, and the worker heartbeat

The single highest-value alert in the system: today nothing detects a dead worker, and every email in
the product flows through it.

**`src/app/api/health/route.ts`** — liveness, no dependencies:

```ts
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ ok: true, at: new Date().toISOString() });
}
```

**`src/app/api/ready/route.ts`** — readiness, checks the database and the worker heartbeat:

```ts
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, boolean> = {};
  try {
    await db.execute(sql`select 1`);
    checks.database = true;
  } catch {
    checks.database = false;
  }

  // Worker liveness: stale heartbeat means jobs (and therefore ALL email) have
  // stopped. This is the condition that is currently undetectable.
  const [hb] = await db
    .select({ at: workerHeartbeats.seenAt })
    .from(workerHeartbeats)
    .orderBy(desc(workerHeartbeats.seenAt))
    .limit(1);
  checks.worker = Boolean(hb && Date.now() - hb.at.getTime() < 5 * 60_000);

  const ok = Object.values(checks).every(Boolean);
  return Response.json({ ok, checks }, { status: ok ? 200 : 503 });
}
```

**Heartbeat table** (additive migration):

```sql
CREATE TABLE worker_heartbeat (
  id      text PRIMARY KEY,          -- one row per worker instance
  seen_at timestamptz NOT NULL DEFAULT now()
);
```

**`scripts/worker.ts`** — write it on an interval, and shut down cleanly:

```ts
const instanceId = process.env.RAILWAY_REPLICA_ID ?? `worker-${process.pid}`;
const beat = setInterval(() => {
  db.insert(workerHeartbeats)
    .values({ id: instanceId, seenAt: new Date() })
    .onConflictDoUpdate({
      target: workerHeartbeats.id,
      set: { seenAt: new Date() },
    })
    .catch((err) => logger.error({ err }, "heartbeat failed"));
}, 60_000);
beat.unref();
```

Clear the interval in `shutdown()`. Point Railway's healthcheck at `/api/ready` and alert on a
non-200 — that single alert closes the worst detection gap in the report.

**`Dockerfile`** (with `SEC-14`):

```dockerfile
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "require('http').get('http://localhost:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
```

---

## A7 — `PERF-02` / `PERF-03`: job fan-out with per-timezone dispatch

Converts each global serial sweep into a dispatcher plus per-business jobs. **The existing handler
bodies already tenant-scope via `createTenantRepo(biz.id)`, so extracting the loop body is mostly
mechanical.** Migrate one queue at a time; start with `photo-retention` (no emails, lowest risk).

```ts
/**
 * Hourly dispatcher. Enqueues one job per business whose LOCAL send hour is now,
 * replacing the fixed-UTC daily cron. Keyset-paginated so it stays O(page) as
 * tenant count grows, and singletonKey'd per (queue, business, date) so a retry
 * or an overlapping run is a no-op rather than a duplicate.
 */
export async function dispatchDailyDigests(
  now: Date = new Date(),
): Promise<number> {
  const boss = await getBoss();
  let after: { createdAt: Date; id: string } | null = null;
  let enqueued = 0;

  for (;;) {
    const page = await db
      .select({
        id: businesses.id,
        createdAt: businesses.createdAt,
        timezone: businesses.timezone,
        digestHour: businesses.digestHourLocal,
      })
      .from(businesses)
      .where(
        after
          ? sql`(${businesses.createdAt}, ${businesses.id}) > (${after.createdAt}, ${after.id})`
          : undefined,
      )
      .orderBy(asc(businesses.createdAt), asc(businesses.id))
      .limit(500);
    if (page.length === 0) break;

    for (const biz of page) {
      const localHour = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: biz.timezone,
          hour: "numeric",
          hour12: false,
        }).format(now),
      );
      if (localHour !== biz.digestHour) continue;

      const runDate = businessDateOf(now, biz.timezone);
      await boss.send(
        QUEUES.certReminder,
        { businessId: biz.id, runDate },
        {
          ...RETRY,
          singletonKey: `${QUEUES.certReminder}:${biz.id}:${runDate}`,
        },
      );
      enqueued++;
    }
    const last = page[page.length - 1]!;
    after = { createdAt: last.createdAt, id: last.id };
  }

  logger.info({ enqueued }, "Daily digest dispatch complete");
  return enqueued;
}
```

Additive columns, defaulted to reproduce today's Sydney behaviour so nothing changes for existing
tenants on deploy:

```sql
ALTER TABLE business ADD COLUMN digest_hour_local   integer NOT NULL DEFAULT 7;
ALTER TABLE business ADD COLUMN reminder_hour_local integer NOT NULL DEFAULT 17;
```

Worker concurrency:

```ts
await boss.work<CertReminderJob>(
  QUEUES.certReminder,
  { batchSize: 10, teamSize: 4, teamConcurrency: 2 },
  async (jobs) => {
    for (const job of jobs) await handleCertRemindersForBusiness(job.data);
  },
);
```

**Migration sequence.** (1) Extract each loop body into `handle*ForBusiness({businessId, runDate})`.
(2) Add the dispatcher beside the existing cron. (3) Move one queue at a time; the per-row cursors
remain correct throughout, so a partially-migrated system is consistent. (4) Delete the old crons one
release after the last queue moves.

---

## A8 — `SEC-06`: PIN hardening

**File:** `src/lib/pin.ts`

The current `registerFailedAttempt` resets the counter when it locks, so the sustainable attack rate
is a flat 5/minute forever — ~16 hours to expected success on a 10,000-key space. Escalating backoff
on a _persistent_ counter is the fix, and it is a small one.

```ts
/** Cumulative-failure backoff. Reset ONLY on a successful PIN. */
const LOCKOUT_LADDER_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export function registerFailedAttempt(
  state: LockoutState,
  now: Date = new Date(),
): LockoutState {
  const attempts = state.failedPinAttempts + 1;
  if (attempts % MAX_PIN_ATTEMPTS !== 0) {
    return {
      failedPinAttempts: attempts,
      pinLockedUntil: state.pinLockedUntil,
    };
  }
  const step = Math.min(
    Math.floor(attempts / MAX_PIN_ATTEMPTS) - 1,
    LOCKOUT_LADDER_MS.length - 1,
  );
  return {
    // Counter is NOT reset — that is what made the old ladder flat.
    failedPinAttempts: attempts,
    pinLockedUntil: new Date(now.getTime() + LOCKOUT_LADDER_MS[step]!),
  };
}

const WEAK_PINS = new Set([
  "0000",
  "1111",
  "2222",
  "3333",
  "4444",
  "5555",
  "6666",
  "7777",
  "8888",
  "9999",
  "1234",
  "4321",
  "0123",
  "2580",
  "1212",
  "1010",
  "6969",
  "2000",
  "1004",
]);

/** New PINs: 4–6 digits, no trivial patterns. Existing 4-digit PINs keep working. */
export function isValidNewPin(pin: string): boolean {
  if (!/^\d{4,6}$/.test(pin)) return false;
  if (WEAK_PINS.has(pin)) return false;
  if (/^(\d)\1+$/.test(pin)) return false; // all same digit
  if (isSequential(pin)) return false; // 1234 / 9876
  return true;
}
```

**Async scrypt (`SEC-07`)** — the synchronous call blocks the event loop for ~50–100 ms per attempt,
which both serialises the kiosk at shift change and gives an attacker CPU amplification. The stored
format is unchanged, so this is a drop-in swap:

```ts
import { scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCb) as (
  pw: string,
  salt: Buffer,
  len: number,
) => Promise<Buffer>;

export async function verifyPin(
  pin: string,
  stored: string | null,
): Promise<boolean> {
  // …parse as before
  const derived = await scrypt(pin, salt, expected.length);
  return timingSafeEqual(derived, expected);
}
```

`verifyPin` becomes async — update the four call sites (kiosk, personal clock, `/me` PIN gate, and
the PIN-action form core).

**Per-kiosk rate limit** — this is the control that closes the venue-wide DoS, because it caps the
attacker rather than the victim. Reuse the existing durable limiter unchanged:

```ts
export const PIN_ATTEMPT_LIMITS = [
  { kind: "min", windowMs: 60_000, max: 20 },
  { kind: "hour", windowMs: 3_600_000, max: 200 },
] as const;

// Key on the kiosk/clock token hash — never on a staff identifier.
await consumeWindow(
  db,
  `pin:${tokenHash}:${limit.kind}`,
  limit.max,
  limit.windowMs,
);
```

**Tests**

```ts
it("escalates lockout duration across repeated batches", …);
it("does not reset the cumulative counter on lock", …);
it("resets only after a successful PIN", …);
it("rejects weak PINs for new enrolments but verifies existing 4-digit PINs", …);
it("rate-limits PIN attempts per kiosk token", …);
```

---

## A9 — Suggested CI additions

**`.github/dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule: { interval: weekly }
    open-pull-requests-limit: 10
    groups:
      patch-and-minor:
        patterns: ["*"]
        update-types: ["minor", "patch"]
  - package-ecosystem: github-actions
    directory: "/"
    schedule: { interval: monthly }
```

**CI steps** (add to the `build` job in `.github/workflows/ci.yml`):

```yaml
- name: Audit dependencies
  run: npm audit --audit-level=high

- name: Assert security headers
  run: npm test -- security-headers
```

Add CodeQL (JS/TS) as a separate workflow and enable GitHub secret scanning + push protection in
repository settings. When `SEC-14` lands, add Trivy image scanning to the worker build.

For accepted risks, keep a reviewed `.audit-allowlist.json` with an advisory id, owner, rationale and
review date, and have the audit step consult it — an explicit, dated exception is defensible; a
lowered threshold is not.

---

## A10 — Verification checklist for Phase 0

Run before closing the phase:

- [ ] Impersonation cookie without a session → rejected; with a _different_ admin's session → rejected
- [ ] Sign-out clears `roster_impersonation`; re-entry from the console still works
- [ ] `npm audit --audit-level=high` exits 0 (or every exception is in the dated allow-list)
- [ ] `curl -I` on `/`, `/app`, `/r/<slug>`, `/f/<slug>` shows the expected header set
- [ ] `/r/<slug>` and `/f/<slug>` return `X-Robots-Tag: noindex`
- [ ] `EXPLAIN (ANALYZE, BUFFERS)` shows index scans on all nine `PERF-01` paths
- [ ] `drizzle-kit generate` produces an empty diff after the schema is synced with the index pack
- [ ] A two-location org receives cert, order and form-digest emails for **both** locations
- [ ] A cross-location covered shift produces a notice visible on the claimer's `/me`
- [ ] `/api/health` returns 200; `/api/ready` returns 503 with the worker stopped
- [ ] Railway healthcheck points at `/api/ready`; the stale-heartbeat alert fires within 5 minutes
- [ ] PIN lockout escalates and does not reset on lock; kiosk-token rate limit engages
- [ ] Full test suite green; `CLAUDE.md` and `README.md` updated in the same PRs
