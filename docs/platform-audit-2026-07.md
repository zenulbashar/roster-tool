# Roster — Platform Audit & Scaling Review

**Date:** 30 July 2026
**Revision reviewed:** `c52bd50` (main), milestones M1–M38 complete
**Codebase:** 192 TS/TSX files · ~41,000 LOC · 34 migrations · 94 test files · 62 routes
**Audit standard:** technical due diligence (enterprise customer / institutional investor)

---

## 1. Executive summary

Roster is a **genuinely well-built vertical SaaS product** that is **not yet a platform**. The
distinction matters, and it is the single most important conclusion of this audit.

What has been built is unusually disciplined for its stage. Tenant isolation is enforced through one
deliberate choke point (`createTenantRepo`), with the cross-tenant exceptions named, documented and
quarantined. Business logic is factored into pure, unit-tested modules (`draft.ts`,
`pay-rules.ts`, `assignment-schedule.ts`, `labour-report.ts`, `order-reminder.ts`) separated from
I/O. Secrets are hashed or AES-256-GCM encrypted, and integrations fail closed when unconfigured.
Idempotency is treated as a first-class concern in every background job. The Xero integration
enforces a hard product boundary structurally — by choosing raw `fetch` over the SDK so that
forbidden methods do not exist — and pins that boundary with a guard test. The 94-file test suite
covers logic and integration behaviour, not just happy paths. **Very few products at this stage have
this much intentionality, and the engineering judgement on display is above market.**

What is missing is everything that turns a single-tenant-shaped product into a multi-tenant
platform. There is **no role model** — `org_role` contains exactly one value, `owner` — so there is
no manager, no supervisor, no employee account, and therefore no path to any customer with a
management hierarchy. There is **no observability**: no error tracking, no metrics, no tracing, no
health endpoint, and nothing that would detect that the single background worker has died and that
every email in the system has silently stopped. There is **no disaster-recovery posture** on record:
no documented RTO/RPO, no restore drill, no backup verification. The **largest table in the data
model has no index on its tenant key**. And the platform is structurally Australian: timezones are
an AU-only enum, currency is hardcoded AUD, locale is hardcoded `en-AU`.

Three findings are, in the auditor's view, **release-blocking for any enterprise deal**, and one is
a **live security defect**:

1. **Impersonation is a bearer capability decoupled from the admin's session** (finding `SEC-01`).
   `requireOwner()` returns from the impersonation branch _before_ `auth()` is ever called, and
   sign-out does not clear the impersonation cookie. A valid `roster_impersonation` cookie alone
   grants two hours of full read/write access to a client's live production account with no signed-in
   session at all. This is the highest-severity finding in the report and is a small fix.
2. **Three production email paths are silently dead for every location except the first**
   (finding `COR-01`). The certification-expiry, stock-order and form-digest jobs resolve the owner's
   address via the legacy `users.businessId` pointer, which is written once at onboarding and never
   updated when a location is added. Multi-location — the flagship M29 capability — silently
   disables compliance reminders for locations 2..N, and logs `"sweep complete"` while doing so.
3. **17 known dependency vulnerabilities (2 critical, 9 high)** ship in production, including in
   direct dependencies `next`, `next-auth` (pinned to a beta), and `nodemailer`, with no SCA in CI,
   no Dependabot, and no SBOM (finding `SEC-04`).

Beyond defects, the scaling ceiling is concrete and calculable. The daily reminder jobs are
**single global sweeps that iterate every business serially inside one job**, issuing ~5 queries and
up to N emails per business. At 1,000 clients × 3 locations this is roughly 15,000 serial queries
and 3,000 serial email sends in one job invocation — an estimated 20–30 minutes of wall clock, on a
`singletonKey` that suppresses overlap, meaning the sweep will begin silently skipping days rather
than failing loudly. That is the architecture's hard limit, and it arrives at roughly **1,500–3,000
locations**, not millions of employees.

**Verdict.** The foundations are sound enough that none of this requires a rewrite. Every finding in
this report is addressable additively on the existing architecture — which is a direct credit to the
tenant-repo pattern, the pure-function discipline and the migration hygiene already in place. The
work is roughly **8–10 engineer-months** to reach enterprise-credible, sequenced below into 28
independently deployable milestones of two weeks or less. The strategic risk is not technical debt;
it is **spending another 38 milestones on features while the platform layer — roles, observability,
API, i18n — stays unbuilt**, because each additional feature built against a single-role,
single-region, unobserved substrate raises the cost of adding that substrate later.

**Status of this document.** This is **revision 1 — a first pass, not exhaustive file coverage.**
About 35 of 192 source files were opened; depth was allocated by risk, so the tenancy, auth, admin,
job and schema layers were read completely and every Critical/High finding rests on a file read in
full. But 38 of 42 pages, 26 of 28 components (including the 1,785-line `RosterBoard.tsx`) and all
but one test file were **not opened**, which is why §2 scores UX and accessibility with explicitly
**low confidence** and why `UX-01`, `UX-02` and `PERF-12` are hypotheses rather than established
findings. §3 gives the full ledger and §3.1 the prioritised remainder. That remainder is not a
formality: a short second pass over four previously-unread files produced `SEC-16` (a staff→owner
phishing path through unescaped email templates), `PERF-13` (a quadratic query on the People page)
and `COR-07`. Expect further findings of that class — concentrated in payroll arithmetic, the
submission cores and the UX surface — and read the current severity distribution as a floor.

---

## 2. Scorecard

Scored against what a Series-A-to-B workforce management platform is expected to demonstrate in
technical due diligence. "Trajectory" reflects whether current practice is improving or accruing debt.

| Domain                              |    Score | Trajectory | One-line assessment                                                       |
| ----------------------------------- | -------: | ---------- | ------------------------------------------------------------------------- |
| Domain modelling                    | **8/10** | ↗          | Genuinely thoughtful; snapshot-vs-reference discipline is excellent       |
| Code quality & readability          | **8/10** | ↗          | Comment quality is exceptional; pure-core/impure-shell separation is real |
| Tenant isolation (design)           | **8/10** | →          | One choke point, named exceptions, documented invariants                  |
| Tenant isolation (defence in depth) | **4/10** | →          | App-layer only; no RLS; repo methods trust caller-supplied FKs            |
| Testing (logic)                     | **8/10** | ↗          | 94 files, integration tests against real Postgres, boundary guard tests   |
| Testing (system)                    | **2/10** | →          | No E2E, no a11y automation, no load test, no visual regression            |
| Database design                     | **6/10** | →          | Sound schema, **critically under-indexed**, no partitioning strategy      |
| Query & read performance            | **4/10** | ↘          | Missing tenant-key indexes; no memoization; no caching layer at all       |
| Background jobs                     | **4/10** | ↘          | Idempotency is excellent; topology is a scaling dead end                  |
| Security — secrets & crypto         | **8/10** | →          | AES-256-GCM, fail-closed, hash-only tokens, timing-safe compares          |
| Security — auth & session           | **4/10** | ↘          | Impersonation unbound to session; no MFA; no SSO; weak PIN policy         |
| Security — hardening                | **2/10** | →          | Zero security headers; no CSP; no robots/noindex on public pages          |
| Supply chain                        | **2/10** | ↘          | 2 critical + 9 high CVEs; beta auth dependency; no SCA, no SBOM           |
| Permissions / RBAC                  | **1/10** | →          | Exactly one role exists; no manager, no employee account                  |
| Observability                       | **1/10** | →          | Structured logs only. No errors, metrics, traces, health, alerts          |
| Reliability & DR                    | **2/10** | →          | Single worker, single region, no documented RTO/RPO or restore drill      |
| CI/CD                               | **5/10** | →          | Clean gates; no staging, no approval on prod migrations, no flags         |
| Accessibility                       | **6/10** | ↗          | Semantic HTML and real ARIA usage; unverified, no automated checks        |
| UX craft                            | **7/10** | ↗          | Design system is coherent; empty/error/loading states incomplete          |
| Internationalisation                | **1/10** | →          | AU timezone enum, hardcoded AUD, hardcoded `en-AU`                        |
| API & extensibility (DX)            | **0/10** | →          | No public API, no webhooks, no API keys, no ecosystem surface             |
| Mobile / offline                    | **2/10** | →          | Responsive web only; no PWA, no push, no offline clock-in                 |
| Compliance readiness                | **3/10** | →          | No tenant audit log; no data-subject export/erasure workflow              |
| AI capability                       | **0/10** | →          | None built; the data foundation for it is largely present                 |
| Documentation                       | **9/10** | ↗          | `CLAUDE.md` + plan docs are the best artefact in the repository           |

**Composite: 4.4/10** — strong product engineering on an unbuilt platform substrate.

---

## 3. Method and coverage

This was a first-principles read of the repository, not a summary of its own documentation. Claims
below are grounded in specific files and line ranges, and several assertions in `CLAUDE.md` were
independently verified against code (two were found not to hold — see `COR-01` and `SEC-03`).

**This is a first-pass audit, not exhaustive file coverage.** Roughly **35 of 192 source files** were
opened. Depth was allocated by risk — the architecture-critical spine was read completely, and every
Critical/High finding rests on a file read in full — but the brief's ambition of reviewing every file,
page and component is **not met by this revision**. The per-area confidence below is the honest
statement of that, and §3.1 lists what remains.

**Reviewed in full:** `src/lib/db/schema.ts` (2,104 lines, all 39 tables); `src/lib/auth/*`;
`src/lib/admin/*` (context, allowlist, impersonation, impersonation-session, repository, actions);
all four `src/lib/tenant/*access*.ts` resolvers; `src/lib/tenant/org-repository.ts`;
`src/lib/jobs/*`; `src/lib/env.ts`; `src/lib/time.ts`; `src/lib/pin.ts`; `src/lib/tokens.ts`;
`src/lib/rate-limit.ts`; `src/lib/logger.ts`; `src/lib/db/index.ts`;
`src/lib/form-response-submission.ts`; `next.config.ts`; `vercel.json`; `Dockerfile`;
`.github/workflows/ci.yml`; `scripts/worker.ts`; `package.json` + full `npm audit`.

**Reviewed in relevant part:** `src/lib/tenant/repository.ts` (4,752 lines — all 189 method
signatures enumerated; staff, availability, assignment, timesheet, notification and photo sections
read in full, ~900 lines total); the roster builder page (~370 of 1,111 lines) and its inline server
actions; `src/lib/validation.ts` (~120 lines); `src/lib/email/templates.ts` (interpolation audit
only); the owner dashboard; `src/components/ui.tsx` (~120 of 495 lines); `src/lib/xero/client.ts`
(method surface); `tests/pay-rules-boundary.test.ts`.

**Surveyed systematically** (grep/census, not read): all 62 route/page/layout files for auth-guard
coverage (one apparent gap found and cleared as a false positive); the 34 migrations for their
`CREATE INDEX` inventory; ARIA and `role` attribute census across all components;
`error.tsx`/`loading.tsx`/`Suspense` census; TODO/`any`/`@ts-ignore` census; retention/GC
verification per unbounded table; `dangerouslySetInnerHTML` sinks (none).

**Not covered — read no part of:** `RosterBoard.tsx` (1,785 lines, the largest file in the app);
38 of 42 `page.tsx` files; 26 of 28 components; **all 94 test files** except the one cited;
`src/lib/xero/{pay-rules,push,resolve,service,tokens,idempotency}.ts`; `src/lib/google-drive/*`;
`src/lib/sso/*`; the four staff submission cores (`leave-`, `stock-check-`, `shift-offer-`,
`internal-form-`); the pure libs `draft.ts`, `labour-report.ts`, `assignment-schedule.ts`,
`roster-insights.ts`, `form-report.ts`, `item-import.ts`, `crypto.ts`, `notices-verification.ts`,
`turnstile.ts`, `geo.ts`, `clock.ts`; the migration bodies; the 7 plan docs in `docs/`.

**Confidence by area.** High: tenancy, auth/session, admin/impersonation, background jobs, schema and
indexing, supply chain, configuration. Medium: the repository layer (sampled), payroll/Xero
(boundary verified structurally, logic unread), validation (sampled). **Low: UX, accessibility and
the drag-and-drop board** — `UX-01`, `UX-02` and `PERF-12` are inferred from page-level data loading
and an attribute census, **not** from reading the board or the pages, and should be treated as
hypotheses to confirm rather than established findings.

**Out of scope by nature:** runtime behaviour under load (no profiling or `EXPLAIN ANALYZE` was run —
performance findings are read from query shape against the verified index inventory and should be
confirmed with production plans); the visual design handoff in `design/`; browser-level screen-reader
verification; penetration testing; actual Neon/Vercel/Railway account configuration, which is outside
the repository and where several reliability findings can only be _partly_ assessed from code.

### 3.1 Remaining work to close coverage

Ordered by expected yield. The second-pass evidence for doing this is direct: reading four previously
unopened files produced `SEC-16`, `PERF-13` and `COR-07` below, and one of those is a staff→owner
privilege crossing.

1. `email/templates.ts` in full, plus every call site, for further untrusted-input paths (`SEC-16`).
2. `RosterBoard.tsx` + the 38 unread pages — closes the Low-confidence UX/a11y section.
3. `xero/pay-rules.ts` and `push.ts` — payroll correctness; the boundary is verified, the arithmetic
   is not.
4. The four staff submission cores — the PIN-gated write paths, adjacent to `SEC-06`.
5. `crypto.ts`, `notices-verification.ts`, `turnstile.ts`, `sso/*`, `google-drive/*` — remaining
   security primitives.
6. The 94 test files — to substantiate rather than infer the testing scores in §2.
7. Migration bodies — to verify constraints and defaults, not just indexes.

**Severity** = exploitability or blast radius today. **Priority** = severity weighted by strategic
cost of delay. Findings are `SEC` (security), `COR` (correctness), `PERF`, `OPS`, `ARCH`, `PROD`
(product), `UX`, `DX`.

Findings rated **Critical/High carry the full 14-field treatment**. Medium and Low findings are
reported in a condensed form that still covers all 14 dimensions, because 60 findings × 14 prose
sections would bury the signal — the compression is deliberate, not an omission.

---

## 4. Part A — Critical findings

### SEC-01 — Impersonation grant is a bearer token decoupled from the admin session, and survives sign-out

- **Severity:** Critical
- **Category:** Security — authentication / session management / privilege escalation
- **Evidence:**
  - `src/lib/auth/context.ts:66-85` — `requireOwner()` calls `resolveImpersonation()` **first** and
    returns a fully-populated `OwnerContext` from that branch. `await auth()` is not reached until
    line 87. The signed-in identity is therefore never consulted on any impersonated request.
  - `src/lib/admin/impersonation-session.ts:37-56` — `resolveImpersonation()` validates the cookie
    HMAC + freshness, re-checks that `claims.adminUserId` is still a `platform_admin`, and re-checks
    the bound location still belongs to the bound org. It **never compares the claimed
    `adminUserId` to the current session's user id.**
  - `src/app/app/layout.tsx:38` — `await signOut({ redirectTo: "/" })`. No call to
    `clearImpersonationCookie()`; the only caller is `exitImpersonation` in
    `src/app/admin/actions.ts:70`.
  - `src/lib/admin/impersonation.ts:22` — `IMPERSONATION_TTL_MS = 2 hours`, `maxAge` set to match.
- **Root cause:** the grant was modelled as a _capability_ (mirroring the `/me` notices proof, per
  the header comment) rather than as an _attribute of an authenticated session_. For the notices
  proof that is correct — it is deliberately session-less. For an admin acting on a third party's
  live production data, the capability model removes the one control that matters: proof that the
  human presenting it is still the authenticated admin, right now.
- **Business impact:** an exfiltrated cookie value yields two hours of unrestricted read/write on a
  named client's live account — rosters, timesheets, pay rates, staff PII, integration
  configuration. Because writes are attributed to the _claimed_ admin id, the audit log will name
  an innocent employee. For any customer with a security questionnaire this is a deal-stopper, and
  under the Australian Privacy Act Notifiable Data Breaches scheme an incident here is likely
  notifiable. Concretely: an admin who signs out on a shared support laptop leaves a live,
  full-access grant to a customer's production account behind them.
- **Technical impact:** the entire owner surface — every page and every server action — is reachable
  with no session. The `ImpersonationWriteGuard` is client-side and therefore not a control here.
  Nothing is stored server-side, so there is **no revocation path** short of rotating `AUTH_SECRET`
  (which would invalidate every session and notices proof in the system).
- **Industry comparison:** Rippling, Workday and Stripe all bind support impersonation to the
  operator's live authenticated session, additionally requiring re-authentication or step-up MFA to
  begin, scoping it to a support case, and terminating it on sign-out. Stripe additionally requires
  the _customer_ to grant access. Roster meets none of these.
- **Recommended implementation:**
  1. In `resolveImpersonation()`, resolve `await auth()` and return `null` unless
     `session.user.id === claims.adminUserId`. This is a ~4-line change and is the whole fix for the
     bearer problem.
  2. Clear the impersonation cookie in the owner layout's sign-out action, and in the sign-in flow
     (a new sign-in must never inherit a prior grant).
  3. Reduce TTL to 30 minutes with explicit renewal from the console; two hours is longer than a
     support interaction.
  4. Add a server-side grant record (`impersonation_session` with `revoked_at`) so a grant can be
     killed centrally, and check it in `resolveImpersonation`. This also gives the audit log a real
     session id to correlate writes against.
  5. Require step-up: re-enter the magic link, or require a second admin's approval, to enter a
     live account.
- **Migration strategy:** steps 1–3 are pure code, backward compatible, no migration. Existing
  cookies fail closed at the new check and admins simply re-enter from the console — acceptable and
  correct. Step 4 is one additive table plus a `revoked_at` check; ship behind a flag, dual-read
  (cookie valid AND grant not revoked) so there is no window where impersonation breaks.
- **Dependencies:** none for 1–3. Step 4 depends on `OPS-04` (audit-log table pattern) if you want
  them to share infrastructure. Step 5 depends on MFA (`SEC-11`) to be meaningful.
- **Estimated engineering effort:** steps 1–3: **0.5 day**. Step 4: **3 days**. Step 5: **3 days**
  (or 1 day if it lands after MFA).
- **Priority:** **P0 — ship steps 1–3 this week.**
- **Expected customer impact:** invisible to owners. Admins re-enter from the console after
  sign-out, which is the correct behaviour and reads as intentional.
- **Expected operational impact:** removes the "admin signed out, grant still live" class of
  incident entirely; makes the audit log defensible; adds a revocation lever that does not currently
  exist.

### SEC-04 — 17 known-vulnerable dependencies in production, including a beta authentication library, with no supply-chain gate

- **Severity:** Critical (aggregate)
- **Category:** Security — supply chain
- **Evidence:** `npm audit` on the committed lockfile: **2 critical, 9 high, 6 moderate; 17 total**
  across 126 production dependencies. Affected **direct** dependencies:
  - `next-auth` — **critical**, installed `5.0.0-beta.31`, advisory range `>=5.0.0-beta.0 <=5.0.0-beta.31` (i.e. the installed version is the vulnerable one)
  - `@auth/core` (transitive, **critical**) — `<0.41.3`; advisories include an uncaught exception on malformed `Bearer` headers (CVSS 7.5, availability) and an email-normalizer validation flaw
  - `next` — **high**, `^16.2.7` resolves below the `<16.2.11` fix boundary
  - `nodemailer` — **high**, used by the dev/SMTP auth transport
  - `@auth/drizzle-adapter` — **high** (via `@auth/core`)
  - `drizzle-kit` → `@esbuild-kit/*` → `esbuild` — moderate
  - transitive high: `axios`, `brace-expansion`, `form-data`, `js-yaml`, `postcss`, `sharp`
  - `.github/workflows/ci.yml` contains **no `npm audit`, no CodeQL, no secret scanning**;
    `.github/` contains exactly one file, so there is **no Dependabot or Renovate configuration**.
- **Root cause:** no automated dependency surveillance. Versions were chosen once and carried
  forward; `next-auth@5` has been in beta for the project's whole life and was pinned rather than
  tracked. Nothing in CI fails on a new advisory, so the vulnerability count can only grow.
- **Business impact:** an unpatched **critical CVE in the authentication library** is the first thing
  a security review finds, and the hardest to defend. Enterprise procurement and SOC 2 both require
  a documented vulnerability-management process with remediation SLAs; there is none. The `@auth/core`
  DoS is remotely reachable on an unauthenticated endpoint.
- **Technical impact:** the auth surface — the highest-value target — is running a pre-release
  dependency with known flaws. `next` sits below its fix line, so any Next.js advisory in that range
  applies to production. Because there is no gate, the next critical advisory will also ship silently.
- **Industry comparison:** universal baseline. Dependabot/Renovate with auto-PRs, an `npm audit`
  or Snyk gate in CI, an SBOM (CycloneDX/SPDX) per release, and a documented remediation SLA
  (typically 7 days critical / 30 days high) are table stakes at this stage. Running a beta auth
  library in production would be flagged by every reviewer.
- **Recommended implementation:**
  1. `npm audit fix` for the non-breaking set; then explicitly upgrade `next` ≥16.2.11 and
     `@auth/core` ≥0.41.3.
  2. Move `next-auth` to a stable release. If v5 stable is unavailable, document the decision, the
     specific advisories accepted, and the mitigation — a knowing, recorded exception is defensible;
     an unnoticed one is not.
  3. Add `.github/dependabot.yml` (weekly, grouped by minor/patch, security updates immediate).
  4. Add an `npm audit --audit-level=high` CI step. Gate on it. Use `npm audit --json` with an
     explicit, reviewed allow-list file for accepted risks rather than lowering the threshold.
  5. Add CodeQL (JS/TS) and GitHub secret scanning; both are free on this repo class.
  6. Generate and attach a CycloneDX SBOM per release.
- **Migration strategy:** patch upgrades first, behind CI; `next` minor upgrade on its own PR with
  the full suite plus a manual smoke of auth, kiosk and the roster board (dnd-kit is the main
  version-sensitive surface). `next-auth` stable is the only change with real behavioural risk —
  give it a dedicated PR and verify the magic-link, database-session and SSO-session paths
  (`src/lib/auth/sso-session.ts` mints sessions directly and is the most coupled to adapter
  internals).
- **Dependencies:** none. Do this first; it is the cheapest credibility win in the report.
- **Estimated engineering effort:** **2 days** for items 1, 3–6. `next-auth` stabilisation:
  **2–4 days** including regression.
- **Priority:** **P0.**
- **Expected customer impact:** none functionally; material in every future security review.
- **Expected operational impact:** converts an unbounded, invisible risk into a tracked queue with
  an SLA; CI begins failing on new advisories instead of shipping them.

---

## 5. Part B — High findings

### COR-01 — Three daily email jobs are silently dead for every location except the owner's first

- **Severity:** High
- **Category:** Correctness — multi-location regression / silent failure
- **Evidence:**
  - `src/lib/jobs/handlers.ts:465-470`, `:562-567`, `:784-789` — all three sweeps resolve the
    recipient with `select({email: users.email}).from(users).where(eq(users.businessId, biz.id))`,
    then `if (ownerEmails.length === 0) continue;`.
  - `users.businessId` is written in exactly one place: `src/app/onboarding/page.tsx:68`
    (`.set({ businessId: business!.id })`). Verified by exhaustive grep — the only other write to
    `users` in the codebase is the SSO provisioning insert at `src/lib/auth/sso-session.ts:56`.
  - `src/app/app/locations/actions.ts:36-47` (`addLocationAction`) creates a `business` and sets the
    active-location cookie. It does **not** touch `users.businessId`.
  - Since M29 the authoritative owner↔tenant edge is `org_membership` (`CLAUDE.md`, invariant N1),
    which these three queries do not use.
- **Root cause:** M29 introduced `org_membership` as the owner-to-tenant relationship and migrated
  the request path (`requireOwner`) to it, but the background-job path was not migrated with it. The
  legacy `users.businessId` pointer was retained as the owner's "home" location and silently became
  a one-of-N pointer.
- **Business impact:** for every multi-location client, **certification-expiry reminders, stock-order
  reminders and the form-response digest never fire for locations 2..N.** Certification expiry is a
  regulatory tripwire in hospitality (RSA, food safety, WWCC): the product's promise is "we will
  warn you before it lapses," and for most locations it does not. The failure is silent in both
  directions — the owner sees no email and no error, and the job logs
  `"Certification reminder sweep complete"` with a count that excludes the skipped locations.
- **Technical impact:** `continue` is indistinguishable from "nothing was due." No warning is logged
  for a business with no resolvable owner, so the defect is undetectable from logs. It will
  reproduce in every future per-business sweep that copies this pattern (three already have).
- **Industry comparison:** Deputy and 7shifts model location managers explicitly and route
  notifications by role and location. The relevant comparison is not the feature but the failure
  mode: silent per-tenant notification loss with no alerting would be a Sev-2 incident anywhere.
- **Recommended implementation:**
  1. Replace the lookup with an org-aware resolver:
     `business → org_id → org_membership → users.email`, filtered to the `owner` role.
  2. `logger.warn` when a business resolves to zero recipients. A tenant with no reachable owner is
     an operational anomaly, not a no-op.
  3. Add a flow test asserting that a two-location org receives reminders for **both** locations —
     the existing tests pass because fixtures are single-location.
  4. Once `RBAC` (`ARCH-02`) lands, route by notification-scope preference rather than "all owners",
     so a 12-location group does not email one person 12 digests.
- **Migration strategy:** pure code change; no migration. Ship with the test from step 3. Consider a
  one-off backfill email ("here is what you missed") only if product wants it — I would not, since
  the cert data is visible in-app and a burst of historic warnings erodes trust in the new ones.
- **Dependencies:** none. Benefits from `PERF-02` (job fan-out), which touches the same code — pair
  them in one milestone.
- **Estimated engineering effort:** **1 day** including tests.
- **Priority:** **P0** — this is a live, silent failure of a compliance-adjacent promise.
- **Expected customer impact:** multi-location owners begin receiving reminders they were promised
  and are not currently getting.
- **Expected operational impact:** removes a class of invisible failure; adds the missing warning
  signal for unreachable tenants.

### PERF-01 — The largest table in the data model has no index on its tenant key; nine hot query paths fall back to sequential scans

- **Severity:** High
- **Category:** Performance — database indexing
- **Evidence:** index inventory extracted from all 34 migration files. Confirmed present/absent:
  - **`roster_assignment`** — **no index whatsoever** beyond the unique constraint on
    `(shift_id, staff_member_id)`. No `business_id` index. No `staff_member_id` index. This table is
    one row per person per shift and is therefore the **largest table in the system** at scale.
    `src/lib/tenant/repository.ts:676-698` (`listAssignments`) filters
    `rosterAssignments.businessId` and cannot use the pair index (wrong leading column).
    `findRosteredShiftForStaffOnDate` (`:1454`) filters on `staff_member_id` — also no usable index.
  - **`shift`** — only `shift_period_idx (roster_period_id)`. No `(business_id, date)`, which is the
    predicate for clock-in shift matching, overlap detection and every date-ranged read.
  - **`availability_response`** — only the two unique constraints. No `business_id`, no `shift_id`.
    `listResponses` (`:523-546`) filters `availabilityResponses.businessId` and joins `shift`.
  - **`timesheet_entry`** — only `(business_id, staff_member_id)`. **No `(business_id, clock_in_at)`**,
    yet all three heavy reads — `listEntriesBetween` (`:1260`), `listApprovedEntriesForExport`
    (`:1298`), `listEntriesForLabourReport` (`:1335`) — filter `business_id` + a `clock_in_at` range.
  - **`roster_period`** — no `business_id` index at all.
  - **`shift_template`**, **`published_roster`**, **`admin_activity`** — no `business_id` index.
  - **`clock_photo`** — no index on `timesheet_entry_id` or `business_id`, so the retention delete
    and per-entry photo lookups scan a table of BLOBs.
  - `staff_loan_active_idx` is a plain index on a boolean — near-useless selectivity; should be
    partial (`WHERE active`).
- **Root cause:** indexes were added per-feature where the developer was thinking about that
  feature's own access path, rather than derived systematically from the tenancy invariant. The rule
  "every domain row carries `business_id`" was applied to the schema but not to the indexes, so the
  most universal predicate in the codebase is the least indexed.
- **Business impact:** the roster builder, the public roster, the timesheet view, the CSV export and
  the labour report all degrade **linearly with the tenant's entire history**, not with the window
  being viewed. A café with three years of data will find "this week's roster" slow, and the natural
  reading is "the product gets slower the longer you use it" — which is the most corrosive possible
  performance perception. On a shared Postgres this is also a noisy-neighbour problem: one large
  tenant's sequential scans evict every other tenant's cache.
- **Technical impact:** at 200 staff × 250 shifts/year × 5 years ≈ 250k `roster_assignment` rows per
  tenant, every builder load scans the tenant's full history. Multiply by tenants sharing one
  instance and the working set stops fitting in shared buffers, at which point latency becomes
  I/O-bound and highly variable. The labour report and export are the same shape on
  `timesheet_entry`.
- **Industry comparison:** below baseline. Any WFM platform at this scale indexes on
  `(tenant, date)` for every time-series table and typically partitions timesheets and assignments
  by month or tenant once past ~10⁸ rows.
- **Recommended implementation:** one additive migration adding, at minimum:
  `roster_assignment(business_id)`, `roster_assignment(staff_member_id)`,
  `shift(business_id, date)`, `availability_response(business_id, shift_id)`,
  `roster_period(business_id)`, `timesheet_entry(business_id, clock_in_at)`,
  `clock_photo(timesheet_entry_id)`, `shift_template(business_id)`,
  `published_roster(business_id)`, `admin_activity(business_id)`; and convert
  `staff_loan_active_idx` to partial. Use `CREATE INDEX CONCURRENTLY`. Then verify each of the nine
  paths with `EXPLAIN (ANALYZE, BUFFERS)` against production-shaped data — the point is to confirm
  index usage, not to assume it. See `docs/platform-audit-2026-07-appendix.md` for ready DDL.
- **Migration strategy:** additive and reversible; no application change. `CONCURRENTLY` cannot run
  inside a transaction, so this must be run **outside** the standard Drizzle migration path — the
  existing `migrate-prod` job wraps migrations and would fail or lock. Run it as a one-off
  maintenance script (documented in the appendix) or split each index into its own non-transactional
  migration. This is the one caveat that matters operationally.
- **Dependencies:** none. Precedes any load testing, since testing an unindexed schema measures the
  wrong thing.
- **Estimated engineering effort:** **1 day** to write and verify; **0.5 day** to run and validate
  plans in production.
- **Priority:** **P0** — highest performance return per hour of work in the entire report.
- **Expected customer impact:** page loads on the heaviest screens should improve by an order of
  magnitude for tenants with history; the "slower over time" effect disappears.
- **Expected operational impact:** large drop in database CPU and I/O; removes the main
  noisy-neighbour vector; makes subsequent capacity planning meaningful.

### PERF-02 — Daily jobs are single global serial sweeps; the architecture ceilings at roughly 1,500–3,000 locations

- **Severity:** High
- **Category:** Performance / architecture — background job topology
- **Evidence:**
  - `src/lib/jobs/queues.ts:43-102` — all six daily jobs are `Record<string, never>`: **no payload,
    therefore no per-tenant partitioning.**
  - `src/lib/jobs/handlers.ts` — every sweep opens with `db.select(...).from(businesses)` with **no
    limit and no filter** (`:452`, `:550`, `:629`, `:655`, `:698`, `:772`), then `for (const biz of
bizRows)` and `await`s 2–6 queries plus N email sends per business, strictly serially.
    `handleCertificationReminders` additionally loads _all_ of each business's certifications.
  - `src/lib/jobs/boss.ts:247-295` — each is scheduled with
    `singletonKey: QUEUES.<name>`, so a run that overruns its daily window does not overlap; the
    next one is suppressed.
  - `src/lib/jobs/boss.ts:142+` — `boss.work()` is registered with no `batchSize`, `teamSize` or
    `teamConcurrency`, and `scripts/worker.ts` runs a single process.
- **Root cause:** the topology is correct for one tenant and was never revisited. Per-row
  idempotency (the cursor columns) was treated as sufficient for retry safety — which it is — and
  that masked the absence of _partitioning_, which is what actually bounds the run.
- **Business impact:** a hard, calculable growth ceiling. At 1,000 clients × 3 locations ≈ 3,000
  businesses × ~5 queries ≈ 15,000 serial round trips, plus up to 3,000 serial Resend calls. At
  ~30ms/query and ~200ms/email that is **roughly 20–30 minutes per sweep** — and six sweeps.
  Past that, runs start colliding with the next day's schedule, `singletonKey` suppresses them, and
  **reminders silently stop for everyone** with a log line that says "complete." A single failure at
  business 2,500 retries the entire sweep from business 1: the cursors prevent duplicate _emails_,
  but not the 12,500 wasted queries.
- **Technical impact:** no horizontal scalability (one process, serial loop); no partial progress
  (retry restarts the sweep); no per-tenant isolation (one tenant's slow query or bad email address
  delays everyone behind it); no backpressure or concurrency control against Resend's rate limits.
- **Industry comparison:** the standard shape is fan-out — a cheap scheduler job enqueues one job
  **per tenant** (or per shard), workers consume in parallel with bounded concurrency, and failures
  are isolated to a tenant with per-tenant retry and a dead-letter queue. This maps directly onto
  Zale Queue and Zale Functions.
- **Recommended implementation:**
  1. Convert each sweep into a **dispatcher** that pages `businesses` (keyset pagination on
     `created_at, id`) and enqueues one job per business with payload `{businessId, runDate}`.
  2. Give the per-business handlers a `singletonKey` of `${queue}:${businessId}:${runDate}` — the
     dedupe guarantee moves from "one sweep" to "one job per tenant per day," which is strictly
     stronger and idempotent under retry.
  3. Set `teamSize`/`teamConcurrency` on the worker; bound email concurrency explicitly.
  4. Add a dead-letter queue plus alerting on exhausted retries (pairs with `OPS-02`).
  5. Emit per-run metrics: tenants processed, skipped, failed, wall clock.
- **Migration strategy:** strictly additive and safely incremental. Keep each existing sweep handler
  as the per-business handler (extract the loop body — the body is already tenant-scoped via
  `createTenantRepo(biz.id)`, so this is mostly mechanical). Add the dispatcher beside it. Migrate
  one queue at a time, `photo-retention` first (no emails, so the lowest-risk validation of the
  pattern), then the digests. Existing cursors remain correct throughout, so a partially-migrated
  system is consistent.
- **Dependencies:** best done in the same milestone as `COR-01` (same functions) and `PERF-03`
  (per-timezone scheduling changes the dispatcher's selection query).
- **Estimated engineering effort:** **1 week** for all six queues plus metrics and DLQ.
- **Priority:** **P1** — not yet customer-visible, but it is the wall the business hits first.
- **Expected customer impact:** none immediately; prevents total, silent reminder failure at scale.
- **Expected operational impact:** failures become per-tenant and visible; sweep wall-clock becomes
  a function of worker count rather than tenant count.

### PERF-03 — Reminder scheduling is fixed-UTC while the product is timezone-per-location

- **Severity:** High
- **Category:** Correctness / product — internationalisation of scheduling
- **Evidence:** `src/lib/jobs/boss.ts:32-54` — six hardcoded UTC crons, each commented with its
  Sydney-local intent (`"0 21 * * *"` = "21:00 UTC ≈ 7–8 am Sydney"). Meanwhile
  `business.timezone` is per-location (`schema.ts:78`) and the handlers correctly compute
  business-local dates via `businessDateOf`. The _date arithmetic_ is timezone-aware; the _trigger
  time_ is not.
- **Root cause:** the crons were written when every tenant was in Sydney, and the intent was encoded
  in a comment rather than in data.
- **Business impact:** the moment a client exists outside eastern Australia, reminders land at the
  wrong time of day. A Perth venue (UTC+8) gets its "morning" digest at 05:00; a London venue at
  22:00; a Los Angeles venue receives "you work tomorrow" at 23:00 the night before — after most
  staff have stopped looking at their phones. For the shift reminder in particular, delivery time
  _is_ the feature. This silently caps the product's addressable market at one timezone band.
- **Technical impact:** DST doubles the error twice a year even within Australia. It also
  concentrates all load into six global spikes rather than spreading it across the day — which
  interacts badly with `PERF-02`.
- **Industry comparison:** every WFM platform schedules notifications in the recipient's or the
  location's local time. Deputy and 7shifts both expose per-location notification timing.
- **Recommended implementation:** replace daily crons with an **hourly dispatcher**. Each hour,
  select the businesses whose _local_ time now matches their configured send hour and enqueue only
  those. Add `business.digest_hour_local` (default 7) and `business.reminder_hour_local`
  (default 17). This composes exactly with the `PERF-02` dispatcher — same query, extra predicate —
  and naturally spreads load across 24 windows.
- **Migration strategy:** additive columns with defaults that reproduce today's Sydney behaviour for
  existing tenants, so nothing changes for them on deploy. Switch queue by queue. Keep the old cron
  disabled but present for one release as a rollback path.
- **Dependencies:** `PERF-02` (share the dispatcher). Also unblocks `PROD-06` (global timezones) —
  offering non-AU timezones before this is fixed would ship a known-broken experience.
- **Estimated engineering effort:** **3 days** on top of `PERF-02`.
- **Priority:** **P1** — blocking for any non-AU customer.
- **Expected customer impact:** reminders arrive when intended, everywhere.
- **Expected operational impact:** email load spreads from six spikes to a rolling hourly profile.

### OPS-01 — No observability: a dead worker stops every email in the system, undetectably

- **Severity:** High
- **Category:** Operations — observability, monitoring, alerting
- **Evidence:**
  - No error tracking: no Sentry or equivalent in `package.json`.
  - No metrics, no tracing: no OpenTelemetry, no Prometheus, no custom instrumentation. `pino` logs
    only (`src/lib/logger.ts`).
  - **No health or readiness endpoint anywhere** in 62 routes.
  - `scripts/worker.ts` is a single process that calls `registerWorkers()` and logs "Worker
    started." The `Dockerfile` has **no `HEALTHCHECK`**.
  - No request correlation id: `logger` is a bare module-level instance with no per-request child
    binding, so log lines from one request cannot be joined.
  - `RETRY = { retryLimit: 5, retryBackoff: true }` (`boss.ts:63`) with **no dead-letter handling
    and no alerting** on exhaustion.
  - No `error.tsx` / `global-error.tsx` anywhere, so server exceptions surface as Next's default
    error page and are recorded nowhere.
- **Root cause:** observability was deferred as non-functional. Because pg-boss failures are silent
  by design (a job that throws is retried, then abandoned), the absence of alerting converts every
  worker-side failure into permanent silence.
- **Business impact:** **the highest-probability serious incident in the system is a worker that
  dies quietly.** Every email — availability requests, roster publishes, leave decisions, swap
  approvals, cert reminders — flows through pg-boss. If the worker stops (OOM, deploy failure,
  database failover leaving the poller wedged), owners simply stop receiving mail, staff stop
  receiving rosters, and **the first signal is a customer complaint days later**. Mean time to
  detection is effectively unbounded. Once a paying customer misses a roster publish because of
  this, the churn conversation is not about the bug, it is about trust.
- **Technical impact:** no MTTD, no MTTR baseline, no error budget, no SLOs, no capacity signal.
  Every performance finding in this report is currently unmeasurable in production, so remediation
  cannot be validated. Debugging a customer report means reading unlinked log lines.
- **Industry comparison:** far below baseline. Expected: error tracking with release tagging, RED
  metrics per route and per queue, distributed tracing across web → DB → queue, health/readiness
  probes wired to the platform's restart policy, an alert on queue depth and job failure rate, and
  published SLOs.
- **Recommended implementation:**
  1. **Health endpoints** — `GET /api/health` (liveness: process up) and `GET /api/ready`
     (readiness: `SELECT 1` plus pg-boss reachable). Point Railway's healthcheck and Vercel
     monitoring at them.
  2. **Worker heartbeat** — the worker writes a timestamp every 60s; alert if it goes stale >5
     minutes. This is the single highest-value alert in the system, and it is ~20 lines.
  3. **Error tracking** — Sentry (or Zale-native equivalent) in web and worker, with release and
     tenant tags. Scrub PII at the SDK boundary, mirroring the `pino` redaction list.
  4. **Correlation ids** — generate a request id, bind a `logger.child({requestId, businessId})`
     into request context, and include it in user-facing error copy for support.
  5. **Queue metrics** — depth, oldest-pending age, failure rate, DLQ size per queue; alert on
     oldest-pending age (the metric that actually catches a wedged worker).
  6. **`global-error.tsx` + per-route `error.tsx`** with a branded recovery UI that reports to
     Sentry and shows the correlation id.
  7. Publish internal SLOs (e.g. roster publish email delivered <5 min p95) and alert on breach.
- **Migration strategy:** entirely additive; no schema, no behaviour change. Ship 1+2 first — they
  are hours of work and close the worst gap. Then 3+4, then 5+6.
- **Dependencies:** none. `PERF-02`'s DLQ work should land after item 5 so it has somewhere to
  report.
- **Estimated engineering effort:** items 1–2: **1 day.** Items 3–4: **3 days.** Items 5–6:
  **3 days.** Total **~1.5 weeks.**
- **Priority:** **P0 for items 1–2**, P1 for the rest.
- **Expected customer impact:** incidents are caught by Roster rather than reported by customers;
  errors become a branded page with a reference code instead of a blank failure.
- **Expected operational impact:** transformative. This is the difference between operating a
  product and hoping about one.

### SEC-05 — No security headers of any kind

- **Severity:** High
- **Category:** Security — hardening
- **Evidence:** `next.config.ts` contains no `headers()` function; `vercel.json` contains no
  `headers` key. Verified by grep across both. Therefore **no** `Content-Security-Policy`,
  `Strict-Transport-Security`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`,
  `X-Content-Type-Options`, or `Permissions-Policy`.
- **Root cause:** never configured; Next.js ships no secure defaults here.
- **Business impact:** it is the first automated check any prospect runs (an observatory scan, or
  their scanner-of-choice), and it fails comprehensively. Missing HSTS permits SSL-stripping on
  first contact. Missing `frame-ancestors` permits framing — which is materially worse than usual
  here, because the impersonation UI's entire safety story is a **visual** banner and frame, and a
  clickjacked owner surface defeats it. Missing `Referrer-Policy` leaks capability slugs
  (see `SEC-08`).
- **Technical impact:** no CSP means any future injected script executes with full page authority,
  and the third-party Turnstile script loads with no allow-list constraint. No
  `X-Content-Type-Options` leaves MIME-sniffing open on the clock-photo and CSV responses, which are
  precisely the routes serving user-supplied bytes.
- **Industry comparison:** universal baseline; typically enforced in CI via a header-assertion test.
- **Recommended implementation:** add `headers()` in `next.config.ts` with `HSTS`
  (`max-age=63072000; includeSubDomains; preload`), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` allowing only
  `camera=(self)` and `geolocation=(self)` (both genuinely needed — kiosk photos, GPS clock-in) and
  denying the rest, and a CSP starting in `Content-Security-Policy-Report-Only` with
  `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, allow-listing Turnstile and the
  Google Fonts origins used by `src/app/layout.tsx`. Add a test asserting the header set so it
  cannot silently regress.
- **Migration strategy:** ship all non-CSP headers immediately — zero functional risk. Run CSP in
  report-only for two weeks, triage reports (inline styles and the Material Symbols font are the
  likely violations), then enforce. Nonce-based script policy will require a small change to the
  Turnstile widget mount.
- **Dependencies:** none. `SEC-08` (noindex/referrer) belongs in the same milestone.
- **Estimated engineering effort:** **1 day** for non-CSP headers plus the test; **3 days** for CSP
  to enforcement.
- **Priority:** **P0** for the cheap headers; P1 for CSP enforcement.
- **Expected customer impact:** none.
- **Expected operational impact:** removes a whole class of scanner findings from every future
  security review.

### SEC-06 — 4-digit PINs with a resetting 60-second lockout are brute-forceable, and enable a venue-wide clock-in denial of service

- **Severity:** High
- **Category:** Security — authentication strength / availability
- **Evidence:**
  - `src/lib/pin.ts:26` — `isValidPinFormat` requires **exactly 4 digits** (10,000 keyspace), with
    no weak-PIN blocklist (`0000`, `1234`, birth years all permitted).
  - `:21-23` — `MAX_PIN_ATTEMPTS = 5`, `PIN_LOCKOUT_MS = 60_000`.
  - `:70-82` — `registerFailedAttempt` **resets `failedPinAttempts` to 0** when the limit is hit and
    sets a 60s lock. There is no escalating backoff and no cumulative failure ceiling, so the
    attacker's sustainable rate is a flat **5 attempts per minute, indefinitely** — 300/hour,
    expected success at ~16 hours, exhaustive at ~33 hours, per staff member.
  - The lockout is keyed **per staff member only** — not per device, IP or kiosk. `staffMembers`
    carries `failedPinAttempts` / `pinLockedUntil` (`schema.ts:493-494`).
  - Blast radius of one PIN: clock in/out, submit leave, release and claim shifts, submit stock
    checks, and — via `/me` — read that person's private notices and submit attributed internal
    forms.
  - `src/lib/tenant/repository.ts:174-180` — `listActiveStaffForKiosk` returns every active staff
    **name** to anyone holding the kiosk link, which supplies the attacker's target list.
- **Root cause:** the PIN was scoped as a convenience factor for a trusted shared tablet, and the
  lockout was tuned to avoid locking out fumbling staff. Both are reasonable in isolation; the
  combination leaves no rate ceiling. The threat model was not revisited when the same PIN was later
  extended to guard leave, shift swaps and `/me` personal data.
- **Business impact:** two distinct harms. **Impersonation** — a colleague or anyone who obtains the
  kiosk link can eventually clock a co-worker in or out (wage fraud, falsified records), submit
  leave in their name, or give away their shifts. In a wage dispute, "the record shows they clocked
  in" becomes indefensible. **Denial of service** — because the staff list is readable and the
  lockout is per-person, an attacker can lock out _every_ staff member at a venue with five wrong
  PINs each and repeat indefinitely. At shift change, nobody can clock in, and there is no override
  on the kiosk (only the owner's web timesheet editor).
- **Technical impact:** no device binding, no IP-level limit, no anomaly signal, no notification to
  owner or staff on repeated failures. Because attempts are cheap and unlogged as a security event,
  the attack is invisible.
- **Industry comparison:** Deputy and 7shifts pair a PIN with device registration and/or facial
  verification, and escalate lockouts. Tanda leans on device binding. The consistent pattern is that
  a short PIN is only ever _one_ factor, bound to a _known device_.
- **Recommended implementation:**
  1. **Escalating backoff** with a persistent counter: 1m → 5m → 15m → 1h, and do not reset the
     cumulative counter on lock — reset only on a _successful_ PIN. This alone converts 33 hours
     into years.
  2. **Weak-PIN blocklist**: reject repeated digits, sequences, and the top-100 known PINs; require
     6 digits for new PINs (keep 4 working for existing staff, prompt to upgrade).
  3. **Per-device and per-kiosk rate limits** in addition to per-staff, reusing the existing durable
     `form_rate_limit` mechanism keyed on the kiosk token — this is the control that closes the DoS,
     because it caps the _attacker_, not the victim.
  4. **Device binding** for the personal-clock route: a per-device token issued on first successful
     PIN, so a stolen link alone is insufficient.
  5. **Notify** the owner (in-app + email) on N lockouts within a window; notify the staff member
     via `/me` on repeated failures against their PIN.
  6. Log PIN failures as security events with the kiosk token id once `OPS-01` lands.
- **Migration strategy:** items 1, 3, 5 are backward compatible and need no schema change beyond
  possibly widening the counter's semantics. Item 2 applies to new PINs only, with a soft prompt for
  existing ones — never force a re-PIN across a venue mid-service. Item 4 is additive
  (`clock_device` table) and can be optional per business at first.
- **Dependencies:** item 6 depends on `OPS-01`. Item 3 reuses `src/lib/rate-limit.ts` as-is.
- **Estimated engineering effort:** items 1–3: **3 days.** Item 4: **1 week.** Items 5–6: **2 days.**
- **Priority:** **P1** (P0 for item 1 — it is a few lines and removes the brute-force path).
- **Expected customer impact:** slightly stricter PIN rules for new staff; visible protection
  against colleague impersonation, which is a real and frequently-cited hospitality concern.
- **Expected operational impact:** removes the venue-wide clock-in DoS; converts silent PIN attacks
  into an alertable signal.

### SEC-02 — The impersonation audit log is client-authored, unauthenticated, and unbounded

- **Severity:** High
- **Category:** Security — audit integrity
- **Evidence:**
  - `src/app/admin/actions.ts:81-98` — `logImpersonatedWrite({action, detail})` is an exported
    `"use server"` action that takes **both log fields as free text from the client** and writes
    them to `admin_activity`. It calls `resolveImpersonation()` but **not `requireAdmin()`**.
  - `src/components/ImpersonationWriteGuard.tsx` — the caller is a **client-side** capturing
    `submit` listener. Per `CLAUDE.md`'s own admission, "a few JS-driven server actions (e.g. the
    drag-drop board) aren't gated by the modal."
  - `src/app/admin/actions.ts:111-118` — `setPlanStatus` records `isWrite: false` for what is
    unambiguously a write to `organisations`, and writes to `organisations` directly rather than
    through `createAdminRepo`, contrary to the documented single-choke-point rule.
  - No rate limit and no retention on `admin_activity` (`schema.ts:311`); no `business_id` index.
- **Root cause:** the audit log was designed to _describe_ the UI's intent rather than to _observe_
  the server's actions, so its fidelity depends on a cooperating client.
- **Business impact:** the audit log is the entire accountability story for impersonation — it is
  what you show a customer who asks "what did your staff do in my account?" As built, the answer is
  "what our UI voluntarily reported," which does not survive scrutiny. A malicious or careless admin
  can act without a log entry (bypass the client guard) or write misleading entries. Combined with
  `SEC-01`, entries can be attributed to an admin who was not present.
- **Technical impact:** `is_write` is advisory, not observed. The log can be flooded (no rate limit,
  no retention) to bury real entries — log-stuffing is a recognised anti-forensics technique.
  Unindexed `business_id` makes per-tenant retrieval a scan.
- **Industry comparison:** support-impersonation audit trails are server-derived and
  tamper-evident: written in the same transaction as the mutation, immutable (append-only with
  restricted grants), often hash-chained, and retained on a defined schedule. Client-reported audit
  entries would not pass a SOC 2 Type II control test for logging.
- **Recommended implementation:**
  1. Move audit writing **server-side into the mutation path**. The cleanest lever on this codebase:
     since every tenant write already flows through `createTenantRepo`, wrap the repo in an
     auditing decorator when `ctx.impersonation` is set, so _every_ write is logged with the method
     name and target id, by construction, with no per-action annotation. This also closes the
     drag-drop gap for free.
  2. Keep the client modal purely as consent UX; stop trusting its output.
  3. Add `requireAdmin()` to any action that remains callable, and validate/truncate its text.
  4. Correct `setPlanStatus` to `isWrite: true` and route it through the admin repo.
  5. Add `admin_activity(business_id)` and `(admin_user_id, created_at)` indexes, a retention
     policy (e.g. 24 months), and consider a hash chain (`prev_hash`) for tamper evidence.
  6. Restrict `UPDATE`/`DELETE` on `admin_activity` at the database-grant level.
- **Migration strategy:** the decorator is additive and can ship behind a flag, logging in parallel
  with the existing path; compare coverage for a week, then remove the client path. Indexes and
  retention are additive.
- **Dependencies:** `SEC-01` (a server-side grant id makes correlation meaningful); shares
  infrastructure with `OPS-04` (tenant audit log) — build one mechanism, two consumers.
- **Estimated engineering effort:** **1 week** for the decorator plus indexes and retention; **1 day**
  for items 3–4.
- **Priority:** **P1.**
- **Expected customer impact:** none visible; materially strengthens the answer to the most probing
  question enterprise buyers ask about vendor access.
- **Expected operational impact:** the audit log becomes evidence rather than an assertion.

### PERF-04 — Owner request context is recomputed on every call; 3–5 duplicate auth queries per request

- **Severity:** High
- **Category:** Performance — request path
- **Evidence:** `requireOwner()` (`src/lib/auth/context.ts:66`) performs, in sequence:
  `resolveImpersonation()` (cookie parse; on the admin path a `platform_admin` lookup plus a
  business/org join), `auth()` (a database session lookup — `session: {strategy: "database"}`),
  `resolveOrgForUser()` (one query), and `resolveActiveLocation()` (one query that loads **all** of
  the org's locations). **`React.cache()` is used nowhere in the codebase** (verified by grep). Each
  of `ownerRepo()`, `orgRepo()` and `ownerContext()` calls `requireOwner()` afresh, and the owner
  layout, the page and every inline server action each call one of them — e.g.
  `src/app/app/periods/[id]/build/page.tsx` calls `requireOwner()` in the page body and again in
  each of its ~10 server actions.
- **Root cause:** the guard was written as a self-contained function, and Next.js's per-request
  memoization primitive was never adopted.
- **Business impact:** every owner page pays 3–4× the necessary authentication latency, on the
  critical path to first byte, for every request. It is invisible in development and compounds
  directly into the perceived slowness of the whole owner area.
- **Technical impact:** 6–10 redundant queries per page render. Against a pooled Neon endpoint each
  costs a round trip; with `max: 10` per pool instance (`PERF-08`) this consumes connection budget
  that concurrency needs. It also amplifies every authentication query into a hot spot, which is
  where `PERF-01`'s missing indexes bite hardest.
- **Industry comparison:** standard practice in App Router codebases is a `cache()`-wrapped
  request-scoped context resolved once per request.
- **Recommended implementation:** wrap `requireOwner` in `React.cache()` (per-request memoization,
  not cross-request caching — important, since it must not leak across users). Then have
  `ownerRepo`/`orgRepo`/`ownerContext` consume the memoized value. Where a server action must
  re-validate independently for security, keep an explicit uncached variant and use it deliberately
  — the two cases are different and should be named differently
  (`requireOwner` vs `requireOwnerFresh`).
- **Migration strategy:** pure code, no schema. Verify with a query-count assertion in an
  integration test so the improvement cannot silently regress. Take care that `cache()` semantics
  are per-request; add a test proving two different sessions in the same process do not share.
- **Dependencies:** none.
- **Estimated engineering effort:** **2 days** including tests.
- **Priority:** **P1** — small, safe, measurable.
- **Expected customer impact:** noticeably faster owner pages, especially on cold serverless
  invocations.
- **Expected operational impact:** meaningful reduction in database round trips and connection
  pressure.

### PERF-05 — The admin clients list is unbounded and aggregates over the two largest tables with no time bound

- **Severity:** High
- **Category:** Performance — cross-tenant queries
- **Evidence:** `src/lib/admin/repository.ts:129-217` (`listClients`):
  - loads **every** `organisation` with no `LIMIT` and no pagination;
  - loads **every** `business` for those orgs;
  - then `lastActiveByOrg` (`:96-124`) runs `max(timesheet_entry.clock_in_at)` joined to
    `business` **grouped by org over the entire table with no date predicate**, and the same for
    `roster_period.created_at`;
  - `getClientStats` (`:220-247`) does a full `count(*)` over `staff_member`;
  - search is `ilike(organisations.name, '%q%')` (`:137`) — leading wildcard, so unindexable.
    Recall from `PERF-01` that `timesheet_entry` has no `(business_id, clock_in_at)` index.
- **Root cause:** written against a handful of seeded organisations, where every one of these is
  instant. The query shape encodes an assumption of small N that the console's whole purpose
  contradicts.
- **Business impact:** the admin console — the tool the support team uses when a customer is already
  unhappy — becomes the slowest page in the system and eventually times out, precisely as the
  business grows. Support degrades exactly when it is most needed.
- **Technical impact:** at 3,000 businesses and ~10⁷ timesheet rows, the two `max()` aggregates are
  full scans of the largest tables, with sorts and hash aggregates, on every page load. There is no
  pagination to bound result size and no caching, so each admin refresh repeats it. This is also the
  one code path that can affect _all_ tenants' database performance at once.
- **Industry comparison:** internal consoles at this scale use paginated cursors, denormalised
  per-tenant activity counters maintained on write (or refreshed periodically), and a search index
  (trigram or external) rather than `LIKE '%…%'`.
- **Recommended implementation:**
  1. Keyset-paginate `listClients` (default 50).
  2. Denormalise `organisation.last_active_at`, updated cheaply by the daily sweep or on write, and
     read it directly — removing both `max()` aggregates from the request path entirely.
  3. Maintain `organisation.staff_count` / `site_count` as counters, or accept a periodically
     refreshed materialised view. Do not compute them per request.
  4. Add a `pg_trgm` GIN index on `organisation.name` for search.
  5. Cache the KPI tiles for 60s — they are operational context, not a ledger.
- **Migration strategy:** additive columns with a backfill; dual-read (computed if null, else
  stored) so the console works throughout. Pagination is a UI change — ship behind the same
  milestone.
- **Dependencies:** `PERF-01` (the interim index makes the current query survivable while this is
  built); `PERF-02` (the sweep is the natural place to refresh counters).
- **Estimated engineering effort:** **1 week.**
- **Priority:** **P2** today (small N), **P1** the moment client count passes a few hundred.
- **Expected customer impact:** none directly; faster support resolution indirectly.
- **Expected operational impact:** removes the only routine full-table scan of `timesheet_entry` in
  the codebase.

### PERF-06 — Clock-in photos are stored as `bytea` in the primary database

- **Severity:** High
- **Category:** Performance / cost — storage architecture
- **Evidence:** `schema.ts:873-887` — `clock_photo.image_data bytea NOT NULL`, in the operational
  database, cascading from `timesheet_entry`. `src/lib/db/schema.ts:28-32` documents the choice as an
  MVP shortcut ("so we don't need external object storage"). Served through
  `src/app/app/timesheets/photo/[id]/route.ts` via `getPhoto`, which loads the full row into Node
  memory. No index on `clock_photo(timesheet_entry_id)` (`PERF-01`).
- **Root cause:** a deliberate, well-documented MVP trade-off that has not been revisited now that
  the feature is real and retention is configurable up to 90 days.
- **Business impact:** direct, super-linear infrastructure cost. At 100 staff per venue × 2 photos
  per shift × ~20 shifts/month × 100 KB ≈ **400 MB per venue per month**; at 90-day retention that
  is ~1.2 GB resident per venue. Across 3,000 venues, ~3.6 TB **in Postgres** — where storage is
  priced at a large multiple of object storage, and where it also inflates every backup and every
  restore. The cost is not the storage; it is the _restore time_, which is a DR concern (`OPS-03`).
- **Technical impact:** every photo write goes through WAL, so replication lag, backup size and PITR
  window all scale with image volume rather than business data. Large TOAST rows evict useful pages
  from shared buffers, degrading unrelated queries. The retention delete becomes a high-churn bulk
  DELETE that generates dead tuples and vacuum pressure on the primary. Photo bytes also pass
  through the serverless function's memory on read.
- **Industry comparison:** every comparable platform stores clock-in evidence in object storage with
  signed, short-lived URLs, keeping only a reference in the database — exactly the pattern this
  codebase _already implements correctly_ for Google Drive documents (`staff_document` holds a
  reference, never bytes). The right architecture is already present in the repo; it just was not
  applied here.
- **Recommended implementation:** introduce a `BlobStore` interface (`put`/`get`/`delete`/
  `signUrl`) with an S3-compatible implementation, targeting **Zale Storage** when available.
  Replace `image_data` with `storage_key` + `content_length` + `checksum`. Serve via short-lived
  signed URLs (60s) rather than proxying bytes. Point the retention job at the store, deleting
  objects then rows. Mirror the Drive integration's disciplines: never log bytes, validate MIME and
  size before write, and treat a store failure as non-fatal for the clock-in itself (a missing photo
  must never block clocking — the current code is already correct on this and must stay so).
- **Migration strategy:** classic expand/contract. (1) Add the new columns and dual-write new
  photos to both. (2) Backfill existing rows to the store with a resumable batch job. (3) Switch
  reads to prefer `storage_key`, falling back to `image_data`. (4) After the retention window has
  fully rotated (≤90 days) plus a margin, drop the column. No customer-visible step. **Note:
  dropping a `bytea` column is a destructive migration and per this repo's own CI documentation must
  be run manually, not through `migrate-prod`.**
- **Dependencies:** Zale Storage availability, or S3/R2 in the interim. Signed URLs interact with
  `SEC-05`'s CSP (`img-src`).
- **Estimated engineering effort:** **1.5 weeks** including the backfill job and tests against a
  fake store (follow `tests/google-drive-flow.test.ts`, which already establishes the pattern).
- **Priority:** **P2** now; **P1** before onboarding any multi-site chain with photo capture on.
- **Expected customer impact:** faster timesheet pages with photos; no functional change.
- **Expected operational impact:** database size decoupled from image volume; backup and restore
  times return to being a function of business data; unblocks a realistic RPO.

### ARCH-02 — Exactly one role exists in the entire system

- **Severity:** High
- **Category:** Architecture / product — authorisation model
- **Evidence:** `schema.ts:229` — `export const orgRole = pgEnum("org_role", ["owner"])`. One value.
  `org_membership.role` defaults to `owner` and is never read for a decision anywhere:
  `resolveOrgForUser` (`src/lib/tenant/org-access.ts:39-48`) selects the first membership **without
  filtering on role at all**. There is no permission check beyond "is this business in your org."
  There is no staff-facing account of any kind — staff reach the product only through per-person
  capability links plus a PIN (`/me`, `/kiosk`, `/clock`).
- **Root cause:** correct MVP scoping for an owner-operated café, carried forward unchanged through
  M29's multi-location work. The `role` column was added as a placeholder, which was the right
  instinct, but the enforcement layer it implies was never built.
- **Business impact:** **this is the single largest commercial constraint in the product.** Every
  target competitor sells to businesses with a management hierarchy. Without roles, Roster cannot
  serve: a venue manager who should see their own location only; a shift supervisor who can approve
  swaps but not change pay rates; a payroll administrator who sees hours but not rosters; an
  area manager over five venues; or a franchise owner who must not see a sibling franchisee. It also
  means the multi-location feature has no delegation: a 12-venue group is operated entirely by one
  login sharing one password-less magic link. That is disqualifying above roughly 3–5 venues, which
  is exactly the segment where deal sizes become interesting.
- **Technical impact:** authorisation is currently binary and implicit in the tenant scope, so there
  is no interception point at which a permission check could be added. Every future feature encodes
  "the owner can do everything," and each one increases the cost of introducing roles later. The
  absence of any staff account also means no self-service, no push notifications, no mobile app — a
  cascade of blocked capability, not one gap.
- **Industry comparison:** Deputy ships location managers and granular permission groups; 7shifts
  has role-based access by location; Rippling and Workday implement full ABAC with delegated
  administration and approval chains. A single-role model is roughly five years behind the segment.
- **Recommended implementation:** a staged path that does not require a rewrite:
  1. **Extend the enum** — `owner`, `manager`, `supervisor`, `employee` — and add
     `org_membership.business_ids` scoping (or a `membership_location` join) so a manager is bound
     to specific locations.
  2. **Introduce a policy layer** — a single pure `can(actor, action, resource)` module, unit-tested
     exhaustively, called at the top of every server action. Model actions against existing
     capabilities so v1 is a faithful description of today's behaviour with `owner` granted
     everything. That property is what makes it safe to ship.
  3. **Thread an `actor`** through `ownerContext()` and require it in the policy call. Because
     tenancy already funnels through one place, this is a contained change.
  4. **Employee accounts** (`ARCH-03`) as a distinct milestone, keeping capability links as the
     no-account fallback — they are genuinely good UX for casual staff and should not be removed.
  5. **ABAC readiness**: express policy as data (subject attributes × resource attributes ×
     action), not as branching code, so later requirements — "certified staff only", "own department
     only" — are rows rather than releases.
- **Migration strategy:** additive enum values (Postgres `ALTER TYPE ... ADD VALUE`; note it cannot
  run in the same transaction as its use, so sequence it in its own migration). Backfill every
  existing membership to `owner`. Ship the policy layer in _audit mode_ first — evaluate and log
  what it _would_ deny, without denying — for two weeks; when the deny log is empty, enforce. This
  is the safest known way to introduce authorisation into a running system.
- **Dependencies:** foundational. `ARCH-03` (accounts), `PROD-02` (departments), `PROD-11`
  (approval chains) and most of the enterprise roadmap all depend on it. Best sequenced after
  `OPS-01`, so the audit-mode deny log is observable.
- **Estimated engineering effort:** **3 weeks** for items 1–3 (split into two shippable
  milestones); `ARCH-03` a further **3 weeks**.
- **Priority:** **P1 — the highest-value strategic investment in this report.** Nothing else changes
  the addressable market as much.
- **Expected customer impact:** unlocks delegation. Owners stop sharing one login; managers get a
  scoped view; the product becomes usable by multi-venue groups.
- **Expected operational impact:** reduces support load from "owner did something unintended" and
  provides the actor identity that a tenant audit log (`OPS-04`) needs to be meaningful.

### OPS-03 — No disaster-recovery posture on record

- **Severity:** High
- **Category:** Operations — business continuity
- **Evidence:** `README.md` headings cover local setup, deployment and per-integration
  configuration. Verified by grep: **no occurrence of backup, restore, PITR, RTO, RPO, rollback or
  disaster recovery** anywhere in the repository. `.github/workflows/ci.yml:85-124` auto-applies
  migrations to production on merge to `main`, with a `concurrency` guard and additive-only
  discipline documented in comments, but **no GitHub Environment approval gate** and no staging
  step. There is no staging environment referenced anywhere.
- **Root cause:** infrastructure lives outside the repository (Neon, Vercel, Railway), so its
  guarantees were never written down. Neon may well have PITR enabled — the finding is that **the
  team cannot demonstrate it, and has not tested a restore.**
- **Business impact:** blocking in enterprise procurement, which asks for RTO/RPO commitments and
  evidence of a tested restore. More concretely: Roster holds the only record of hours worked. If
  that is lost or corrupted, customers cannot pay their staff — a business-ending event for them and
  reputationally terminal for Roster. An untested backup is an assumption, and restore paths fail in
  practice far more often than teams expect.
- **Technical impact:** no verified recovery path; unknown RPO; no tested procedure under pressure.
  `PERF-06` makes this worse — image bytes inflate the database, so restore time (and therefore RTO)
  scales with photo volume rather than business data. Production migrations apply automatically with
  no human gate, so a bad migration reaches production without a rollback plan.
- **Industry comparison:** expected at this stage: documented RTO/RPO, automated backups with
  verified restores on a schedule, a written runbook, a quarterly restore drill, and a staging
  environment that receives migrations before production.
- **Recommended implementation:**
  1. Document current reality: Neon PITR window, backup schedule, retention, and where secrets are
     escrowed. Publish RTO/RPO targets (a defensible start: RPO 5 min, RTO 4 h).
  2. **Perform a restore drill** into a scratch project and _time it_. Write down what broke —
     something always does.
  3. Write the runbook: database restore, worker outage, Resend outage, OAuth mass-revocation
     (Xero/Drive), and secret rotation for `AUTH_SECRET` and `TOKEN_ENCRYPTION_KEY`. **Note that
     rotating either currently invalidates live artefacts** (sessions, notices proofs, impersonation
     grants; encrypted OAuth tokens) — a versioned-key scheme should be designed alongside.
  4. Add a **staging environment** on a Neon branch; require migrations to pass there first.
  5. Add a GitHub Environment approval gate on `migrate-prod`, and document the manual
     expand/contract procedure for destructive migrations (which `PERF-06` will need).
  6. Add backup verification to the schedule — an automated monthly restore-and-query check.
- **Migration strategy:** documentation and process; no code risk. Items 1–3 are one focused day and
  produce the artefact procurement asks for. Item 4 needs the deployment pipeline touched once.
- **Dependencies:** none. Interacts with `PERF-06` (restore time) and `SEC-13` (key rotation).
- **Estimated engineering effort:** **1 week** for all six, including the drill.
- **Priority:** **P1** — cheap, and blocking for enterprise deals.
- **Expected customer impact:** none visible; directly answers the questions that stall deals.
- **Expected operational impact:** converts an untested assumption into a rehearsed procedure, and
  puts a human between a bad migration and production.

---

## 6. Part C — Medium and Low findings

Reported in condensed form. Every entry still addresses all fourteen dimensions; where a dimension
is inherited from a related finding it says so rather than repeating it.

### Correctness

**COR-02 · Cross-location staff notices are invisible to the recipient · Medium**
`resolveNoticesStaff` (`src/lib/tenant/notices-access.ts`) resolves `businessId` from
`staff_member.business_id` — the person's **home** location — while `listStaffNotifications`
(`repository.ts:2983`) filters on `business_id` **and** `staff_member_id`. Notices created at a
_different_ location (M29 Phase 3 cross-location cover, Phase 4 loans) carry that location's
`business_id` and therefore never appear on `/me`. **Root cause:** `staff_notification` is
business-scoped while its audience is org-scoped. **Business impact:** a person covering at another
venue gets no "you're confirmed", no roster notice and no shift reminder — silently, for exactly the
flows M29 was built to enable. **Technical impact:** the M29 org collapse was applied to
`staff_member` but not to `staff_notification`. **Industry comparison:** notification audience
should follow the person, not the site. **Fix:** scope staff notices by `staff_member_id` (+ `org_id`
for defence) rather than `business_id`; keep `business_id` as context for display ("at Bondi").
**Migration:** read-path change plus an org-scoped repo method; additive. **Dependencies:** none.
**Effort:** 2 days incl. a cross-location flow test. **Priority:** P1. **Customer impact:** staff
covering elsewhere start receiving their notices. **Operational impact:** removes a silent-loss
class.

**COR-03 · No org-level uniqueness on staff identity · Medium**
`staff_member` is unique on `(business_id, email)` only (`schema.ts:512`); there is no
`(org_id, lower(email))` constraint. Since M29 a person is meant to be **one org-level row**, but
adding the same person at a second location via `/app/staff` creates a duplicate. **Impact:** two
rows, two PINs, two pay rates, split timesheets, doubled labour cost, and hours that reconcile
against neither. This is a data-integrity defect that gets harder to unwind over time. **Fix:** add
a unique index on `(org_id, lower(email))`; on the add-staff path, detect an existing org member and
offer "add them to this location" instead. **Migration:** must de-duplicate before the constraint
can be added — write a detection query first and report, do not merge automatically (merging
timesheets is a judgement call the owner must make). **Effort:** 3 days incl. the detection report.
**Priority:** P1 (cost of delay grows). **Industry comparison:** every multi-site WFM keys people at
the org. **Operational impact:** prevents a support-heavy data-repair class.

**COR-04 · `resolveOrgForUser` picks an arbitrary membership · Low**
`src/lib/tenant/org-access.ts:39-48` returns the first `org_membership` row with no `ORDER BY` and no
role filter. Harmless while a user has one membership; the moment multi-org support or agency access
exists, the tenant a user lands in becomes non-deterministic. **Fix:** order deterministically, filter
on role, and make org selection explicit in the UI when a user has more than one. **Effort:** 0.5 day
now, versus a confusing bug later. **Priority:** P3 (P1 if multi-org is on the roadmap).

**COR-05 · A GET page render performs a write · Medium**
`src/app/app/periods/[id]/build/page.tsx:161-163` — rendering the builder mutates the period's status
from `collecting` to `building`. **Impact:** Next.js link prefetch, a bot, or a refresh transitions
domain state without user intent; the page can never be cached; concurrent renders race. **Fix:**
move the transition into an explicit action (an "Open builder" button) or make it idempotent and
deliberate on a POST. **Effort:** 0.5 day. **Priority:** P2. **Industry comparison:** basic HTTP
semantics; also a correctness hazard under React strict/concurrent rendering.

**COR-06 · DST-ambiguous wall-clock conversion · Low**
`zonedDateTimeToUtc` (`src/lib/time.ts:155-166`) derives the offset from the naive-UTC instant, so a
local time that does not exist (spring forward) or occurs twice (fall back) resolves to a
one-hour-off instant. Currently reachable only for `availability_deadline`. **Fix:** resolve the
offset at the target local time and handle the gap/overlap explicitly, or adopt `Temporal` once
available. **Effort:** 1 day. **Priority:** P3 now; P1 before shift _start times_ are ever stored as
instants.

**COR-07 · `removePersonFromLocation` hard-deletes a membership the loan machinery expects to deactivate · Low**
`createOrgRepo.removePersonFromLocation` (`src/lib/tenant/org-repository.ts:206-214`) issues a
`DELETE` on `staff_location`, while `addPersonToLocation` (`:174-180`) upserts with `active: true` and
`createLoan`/`endLoan`/`handleStaffLoanExpiry` all reason about deactivating a row tagged with
`loan_id`. **Root cause:** two mental models for "remove" — soft for loans, hard for manual removal —
in the same table. **Impact:** removing a person from a location while a loan to that location is
active leaves an `active` loan row with no membership, so `/app/people` shows an "On loan to X" marker
for someone who is not a member there, and `endLoan` later finds nothing to deactivate. Cosmetic
today; misleading in exactly the situation the owner is trying to reason about. **Fix:** make manual
removal a deactivation (`active: false`, `loan_id: null`) for symmetry, and have it also end any
active loan to that location. **Migration:** pure code. **Effort:** 0.5 day. **Priority:** P3.
**Industry comparison:** n/a — internal consistency. **Operational impact:** removes a confusing
support case.

### Security

**SEC-16 · Email templates interpolate untrusted values into HTML with no escaping; one path is staff-controlled · Medium-High**
`src/lib/email/templates.ts` builds every message by template-literal interpolation directly into
`bodyHtml`, and **no escaping helper exists anywhere in the email layer** (verified by grep).
Examples: `heading: \`Hi ${staffName},\``; `<strong>${periodLabel}</strong>`;
`<li><strong>${s.dayText}</strong> — ${s.label}, ${s.timeText}</li>`; and
`<a href="${opts.ctaUrl}">` interpolating a URL into an attribute. Most of these fields are
owner-authored, which is a lower bar — but **`orderReminderEmail` (`:268-277`) interpolates
`quantity`**, and `stock_check_entry.quantity`is **free text typed by a staff member** at the
PIN-gated kiosk (the schema documents it as "record-only, never parsed"). **Root cause:** templates
were written as trusted-string formatting; the trust boundary moved when staff-entered fields began
flowing into owner-facing mail, and there was no escaping primitive to catch it. **Business impact:**
a staff member can inject markup — most usefully a link — into an email the **account holder**
receives from Roster's own domain, correctly DKIM/SPF-signed and therefore maximally trusted. The
natural payload is a supplier-payment-change link, which is the single most successful business email
compromise pattern. It is a staff→owner privilege crossing laundered through a trusted channel.
**Technical impact:** script execution is largely mitigated by modern mail clients, so this is
content and link spoofing rather than XSS — but the layer is structurally exposed, so any future
untrusted field (a leave note in a decision email, form content in the digest — explicitly a deferred
feature) becomes an injection with no code change. **Industry comparison:** below baseline; templating
with contextual auto-escaping (or React Email / MJML) is standard, and hand-rolled HTML string
concatenation for outbound mail is a known anti-pattern. **Fix:** add an`escapeHtml`helper and apply
it to **every** interpolation in the HTML variants (the plain-text variants are unaffected);
allow-list and encode`ctaUrl`(assert it starts with`env.APP_URL`); add a test that a payload like
`<a href=x>` survives round-trip escaped. Longer term, move to a templating layer that escapes by
default so this cannot regress. **Migration:** pure code, no schema; escaping changes rendered output
only where markup was present, which is only the attack case. **Dependencies:** none.
**Effort:** 1 day for escaping + tests; 3 days for a templating migration. **Priority:** **P1** — a
staff-controlled path into owner mail is a real boundary crossing and the fix is cheap.
**Customer impact:** none visible. **Operational impact:** closes a phishing vector that would be
attributed to Roster.

**SEC-03 · Impersonation write-guard is client-side and incomplete · Medium**
Covered under `SEC-02`; recorded separately because `CLAUDE.md` presents the write-confirm modal as
a control while itself documenting that JS-driven actions bypass it. **Fix:** the server-side repo
decorator in `SEC-02` supersedes it. **Priority:** P1 (with `SEC-02`).

**SEC-07 · `scryptSync` blocks the event loop on every PIN attempt · Medium**
`src/lib/pin.ts:32,44` use the **synchronous** scrypt at Node's default cost (~50–100 ms). In a
serverless function or the shared Node process this blocks all concurrent work. **Impact:** a kiosk
at shift change serialises; an attacker can amplify a modest request rate into a CPU denial of
service by submitting wrong PINs. **Fix:** switch to async `scrypt`; keep the cost parameters
explicit rather than defaulted. **Migration:** hash format unchanged, so this is a drop-in change.
**Effort:** 0.5 day. **Priority:** P2 (P1 alongside `SEC-06`). **Industry comparison:** synchronous
KDFs in a request path is a known anti-pattern.

**SEC-08 · Public capability pages are indexable and leak their slug via `Referer` · Medium**
No `robots.txt`, no `noindex`, and no `Referrer-Policy` anywhere (verified). `/r/<slug>` publishes
staff first names and shift times; `/f/<slug>` is a public form. Their only protection is slug
entropy — which is undermined if a slug is indexed, or leaked in the `Referer` header when a user
follows an external link from the page. **Impact:** staff schedules — who works when and where — are
sensitive; unintended exposure is a privacy incident under the Privacy Act and reads terribly.
**Fix:** `X-Robots-Tag: noindex, nofollow` on `/r/*` and `/f/*`, a `robots.txt`,
`Referrer-Policy: strict-origin-when-cross-origin` globally (from `SEC-05`), and a product-level
option to require a PIN or expire the public roster link. **Effort:** 0.5 day. **Priority:** P1 —
trivial fix, real exposure. **Operational impact:** removes a plausible privacy-incident path.

**SEC-09 · Capability tokens: one-year cookies, no expiry, coarse revocation · Medium**
`/kiosk/[token]`, `/clock/[token]` and `/me/[token]` each store the **raw token** in a cookie with
`maxAge` of 365 days (`src/app/kiosk/[token]/route.ts:22-30` and peers), and the underlying hashes
never expire. Revocation is per-_business_ (rotate the hash), which invalidates every device at once;
`/me` is per-person, which is better. **Impact:** a photographed kiosk QR grants indefinite access to
the staff roster and clock writes; a departing employee's `/me` link persists until someone
remembers to rotate it. **Fix:** per-device token records with independent revocation and
last-used-at; expiry with silent renewal on use; a device list in Settings ("Front tablet — last used
2 min ago — Revoke"); auto-revoke a `/me` link when a staff member is deactivated (the resolver
already checks `active`, so tighten to also clear the hash). **Effort:** 1 week. **Priority:** P2.
**Industry comparison:** device registration is the norm for shared-device clocking.

**SEC-10 · Repository methods trust caller-supplied foreign keys · Medium**
`assign` (`repository.ts:753`), `unassign`, `clockIn` (`:1132`) and others force `business_id` but
accept `shiftId`/`staffMemberId` unvalidated. Today every caller validates first — verified across
the builder actions (`build/page.tsx:205-212`, `:330-343`, `:385-392`) and the kiosk action
(`kiosk/actions.ts:80-83`) — so **there is no live vulnerability**. But the repo's stated contract is
that it is the isolation boundary, and these methods do not honour it, so a single future caller that
forgets creates a cross-tenant write. **Fix:** validate ownership inside the mutating methods (a
`memberHere`/`shiftHere` subquery in the `WHERE`, or an explicit pre-check returning null), and add a
tenant-isolation test per mutator. `tests/tenant-isolation.test.ts` already establishes the pattern.
**Effort:** 3 days. **Priority:** P2. **Rationale:** defence in depth on the invariant the whole
architecture rests on.

**SEC-11 · No MFA, no SSO, no session management for owners · Medium**
Email magic link is the only authentication path (`src/lib/auth/index.ts`). No TOTP or WebAuthn, no
SAML/OIDC, no SCIM, no session list, no "sign out everywhere", no device or login history, no
notification on new sign-in. **Impact:** a compromised mailbox is a full account takeover of payroll
data with no second factor and no visible trail. Enterprise buyers require SSO; without it Roster
cannot be added to an identity provider's app catalogue. **Fix:** WebAuthn/passkeys as a second
factor (a natural fit — no password exists to phish); a session list with revocation; new-device
notification; then SAML/OIDC + SCIM as an enterprise tier. **Effort:** passkeys 1.5 weeks; sessions
UI 3 days; SAML/OIDC 3 weeks. **Priority:** P2 (P1 for passkeys once RBAC exists and managers hold
accounts). **Industry comparison:** SSO+SCIM is the enterprise entry ticket.

**SEC-12 · No rate limiting on sign-in, server actions, or PIN endpoints · Medium**
The durable limiter (`src/lib/rate-limit.ts`) is applied **only** to public form submissions and
anonymous internal submissions. The magic-link request, every server action, and the PIN endpoints
are unlimited. **Impact:** email bombing an owner's address (also burning Resend quota and
reputation), account enumeration via response timing, and unbounded write pressure from any
authenticated session. **Fix:** extend the existing limiter — it is well built and generic — to
sign-in (per email + per IP), PIN attempts (per kiosk token), and a global per-session action
ceiling. **Effort:** 3 days. **Priority:** P1 for sign-in (cheap, real abuse vector); P2 elsewhere.

**SEC-13 · No key rotation scheme · Low-Medium**
`AUTH_SECRET` signs sessions, notices proofs and impersonation grants; `TOKEN_ENCRYPTION_KEY`
encrypts Xero and Drive OAuth tokens. The `crypto.ts` format is versioned (`v1.<iv>.<tag>.<ct>`) —
good instinct — but there is **no key id**, so rotation means a hard cutover: rotating `AUTH_SECRET`
invalidates every session, and rotating `TOKEN_ENCRYPTION_KEY` renders every stored OAuth token
undecryptable, forcing every tenant to reconnect. **Fix:** key-id in the envelope
(`v2.<keyId>.<iv>.<tag>.<ct>`), a key ring with `primary` + `accepted[]`, and a re-encrypt job.
Support two signing secrets during rotation. **Effort:** 1 week. **Priority:** P2 — but note this is
a _prerequisite for responding to a suspected key compromise_, so it is really incident-readiness
work.

**SEC-14 · Container hardening · Medium**
`Dockerfile`: runs as **root** (no `USER`), single stage, installs **devDependencies in the
production image** (because the worker runs TypeScript through `tsx` at runtime), `COPY . .`, no
`HEALTHCHECK`, base image tagged not digest-pinned. **Impact:** larger attack surface and image
size; a container escape starts as root; no automatic restart of a wedged worker. **Fix:** multi-stage
build compiling to JS, `npm ci --omit=dev` in the runtime stage, non-root `USER node`, `HEALTHCHECK`
against the new `/api/health`, digest-pinned base, and container scanning (Trivy) in CI. **Effort:**
2 days. **Priority:** P2. **Dependencies:** `OPS-01` for the health endpoint.

**SEC-15 · Tenant isolation has a single layer · Medium**
Isolation is entirely application-level. There is **no Postgres RLS**, and the app connects as a
single role with full table access. One missing `WHERE business_id = …` — in a new repo method, an
ad-hoc script, or a future GraphQL resolver — is a cross-tenant breach with nothing behind it.
**Fix:** enable RLS on every `business_id`-scoped table with a policy on
`current_setting('app.business_id')`, set per transaction from the tenant repo. Because access
already funnels through `createTenantRepo`, the setting can be applied in exactly one place. Roll out
in permissive/audit mode, table by table, verifying with the existing isolation tests. **Effort:**
2 weeks. **Priority:** P2 — but it is the strongest single structural answer to "how do you know
tenants can't see each other," which is the question every enterprise security review asks first.

### Performance and scale

**PERF-07 · pg-boss is started inside web request paths · Medium**
`getBoss()` (`src/lib/jobs/boss.ts:65-76`) calls `boss.start()` and then `createQueue()` for all
eleven queues — and it is invoked from the `enqueue*` helpers, which run in **server actions**. On
every serverless cold start this performs pg-boss schema checks plus eleven queue upserts, and may
run maintenance/supervision from a web instance. **Impact:** added cold-start latency on
user-facing writes (publishing a roster, deciding leave) and extra connection pressure. **Fix:** a
send-only client in web (no `supervise`, no `createQueue` — the worker owns schema and queue
creation); keep the full instance in the worker. **Effort:** 2 days. **Priority:** P2.
**Industry comparison:** queue producers should not run queue maintenance.

**PERF-13 · `listPeople()` is O(people × memberships) in JavaScript, unbounded · Medium**
`createOrgRepo.listPeople()` (`src/lib/tenant/org-repository.ts:98-130`) loads **all** of an org's
`staff_member` rows and **all** of its `staff_location` rows with no limit, then for each person runs
`memberships.filter(...)` — a nested scan in JS. The comment states the assumption explicitly: "one
query per table, grouped in memory (org staffing is small)." **Root cause:** a documented small-N
assumption on the one page whose purpose is a large shared staff pool. **Impact:** for a 5,000-person
org with ~15,000 memberships that is ~75 million iterations per `/app/people` render, on the request
path, plus the full row payload in function memory. It degrades quadratically — the failure is sudden
rather than gradual, and it lands on exactly the enterprise-sized customers the org feature exists to
serve. `countLocations()` (`:82-88`) has the same shape in miniature, selecting all rows to return
`rows.length` instead of `count(*)`. **Technical impact:** CPU-bound work in a serverless function
with no pagination and no ceiling; `staff_location` has a `staff_member_id` index, so this should be a
grouped query, not an in-memory join. **Industry comparison:** a people directory at this scale is
paginated and server-aggregated everywhere. **Fix:** build a `Map<staffMemberId, businessId[]>` in one
pass (O(n) instead of O(n²)) as the immediate fix; then paginate the page and aggregate the membership
list in SQL (`array_agg` grouped by staff member). Replace `countLocations` with `count(*)`.
**Migration:** pure code; the returned shape need not change for the O(n) fix, so it is a safe
drop-in. **Dependencies:** benefits from `PROD-01` (departments) as the natural filter axis.
**Effort:** 0.5 day for the Map fix; 2 days with pagination and SQL aggregation. **Priority:** P2
(P1 before onboarding any org above a few hundred people). **Customer impact:** the People page stays
fast as the pool grows. **Operational impact:** removes a quadratic CPU path from the request path.

**PERF-08 · Connection pool and query timeouts unconfigured · Medium**
`src/lib/db/index.ts:16` — `new Pool({ connectionString })` with no `max`, `idleTimeoutMillis`,
`connectionTimeoutMillis`, `statement_timeout`, `application_name` or explicit SSL. **Impact:** pg
defaults to `max: 10` per instance, so connection count is `10 × instances` with no ceiling of your
choosing; **no `statement_timeout` means one pathological query can occupy a connection until the
platform kills the request** — the classic path from a slow query to a site-wide outage. No
`application_name` makes `pg_stat_activity` hard to attribute. **Fix:** set `max` deliberately for
serverless (2–5), `statement_timeout` (5s web / 60s worker), `idle_in_transaction_session_timeout`,
`application_name`, and explicit SSL. Export pool metrics once `OPS-01` lands. **Effort:** 1 day.
**Priority:** P1 — one file, and it converts an unbounded failure mode into a bounded one.

**PERF-09 · No streaming, no loading states, no error boundaries · Medium**
There is **no `Suspense`, no `loading.tsx`, no `error.tsx`, no `not-found.tsx` and no
`global-error.tsx` anywhere** in `src/app` (verified). Every owner page awaits all queries before
the first byte — the builder page awaits nine parallel queries plus four sequential context queries.
**Impact:** on a cold serverless invocation the user sees a blank tab, then everything at once; any
server exception yields Next's unbranded error page with no recovery affordance and no reference
code. **Fix:** route-level `loading.tsx` skeletons, `Suspense` around the expensive regions (the
board, the report, the responses list) so chrome and navigation paint immediately, and
`error.tsx`/`global-error.tsx` with branded recovery plus Sentry reporting and the correlation id.
**Effort:** 1 week across the app. **Priority:** P1 for error boundaries (currently a bad failure
experience), P2 for streaming. **Industry comparison:** Linear-class polish is explicitly the design
target here, and instant skeletons are a large part of why those products feel fast.

**PERF-10 · Unbounded tables with no retention · Medium**
Verified: `notification`, `staff_notification` and `admin_activity` have **no deletion path
anywhere** in the codebase. `form_rate_limit` has **no sweeper** — the schema comment says rows "can
be swept later," and nothing does; every `(ip, slug, window)` mints a row. (`sso_consumed_tokens`
_does_ have GC — `src/lib/sso/replay.ts:56` — and photos have the retention job; credit where due.)
pg-boss archive/retention is left at defaults. **Impact:** monotonic growth in table and index size,
degrading the bell query and inflating backups; `form_rate_limit` grows with public traffic, i.e.
fastest for successful customers. **Fix:** a single `retention` job with per-table policies
(notifications 180 days read / 365 unread; `admin_activity` 24 months — check the compliance
requirement before choosing; `form_rate_limit` delete `expires_at < now()`, plus an index on
`expires_at` to make it cheap); configure pg-boss archive. **Effort:** 3 days. **Priority:** P2.

**PERF-11 · No caching layer of any kind · Medium**
No Redis, no `unstable_cache`, no `revalidate`, no HTTP caching. Every owner page is fully dynamic
and every read hits Postgres. Reference data that changes rarely — business settings, shift
templates, staff lists, the notification-preference columns — is re-fetched on every request, and the
layout's notification bell adds two queries to _every_ page. **Fix:** request-scoped memoization
first (`PERF-04` — the cheapest win); then a short-TTL cache for genuinely static-per-tenant reads
with explicit invalidation on write; then consider edge caching the public roster (`/r/<slug>`),
which is immutable between publishes and is the only page likely to see burst traffic when a roster
drops. **Effort:** 1 week. **Priority:** P2.

**PERF-12 · The roster board loads and ships the whole period to the client · Medium**
`build/page.tsx` loads all shifts, all active staff, all availability responses, all assignments, all
requests, leave, offers and templates for the period, builds several in-memory maps, and hands the
result to a 1,785-line client island. No virtualisation, no pagination, no incremental fetch.
**Impact:** at 20 staff this is excellent — genuinely one of the better roster builders I have read.
At 200 staff × 7 days × several shifts/day the payload and the client render both degrade sharply,
and the drag interaction (which recomputes overlap insights client-side from optimistic state) will
stutter. Enterprise venues have 200+ staff. **Fix:** virtualise rows, paginate or lazily fetch the
staff axis, move overlap computation into a worker or memoise it aggressively, and consider a
department filter (which `PROD-02` provides naturally) as the primary scoping tool. **Effort:**
1.5 weeks. **Priority:** P2 (P1 before onboarding a large-venue customer).

### Architecture and maintainability

**ARCH-01 · `repository.ts` is a 4,752-line, 189-method god object · Medium**
Every domain — staff, shifts, availability, assignments, timesheets, leave, offers, certs, suppliers,
items, stock, notifications, forms, Drive, Xero, pay rules — lives in one closure. **Impact:** merge
contention, an intimidating file for new contributors, no domain boundaries to enforce invariants
against, and a single import that pulls the entire schema into every consumer. **Fix:** split by
domain (`repository/staff.ts`, `repository/roster.ts`, …) composed into the same public object, so
**every call site is unchanged** and the refactor is mechanical and low-risk. Keep `memberHere` and
the shared helpers in a common module. **Effort:** 1 week. **Priority:** P2 — pure maintainability,
but it compounds: every milestone below makes this file bigger.

**ARCH-03 · No employee accounts · High (product), tracked with `ARCH-02`**
Staff exist only as rows reachable via capability links. No login, no password/passkey, no session,
no push token, no preferences, no profile self-service. **Impact:** blocks the mobile app, push
notifications, self-service availability at scale, shift bidding, and any staff-side engagement
metric — which is where competitors derive their stickiness. **Fix:** optional employee accounts
(email or phone + passkey/OTP) layered _beside_ capability links, never replacing them: the
no-account path is genuinely good for casual staff and is a differentiator worth keeping. **Effort:**
3 weeks. **Priority:** P1 after `ARCH-02`. **Migration:** additive; link an account to an existing
`staff_member` on first sign-in via a verified email match.

**ARCH-04 · Postgres enums for extensible sets · Low**
Fifteen `pgEnum` types, several of which are natural extension points (`notification_type`,
`staff_notification_type`, `cert_type`, `leave_type`). `ALTER TYPE ... ADD VALUE` cannot be used in
the same transaction that references the new value, which complicates otherwise-simple migrations,
and enum values cannot be removed. **Fix:** keep enums for genuinely closed sets (`clock_photo_kind`);
move likely-extensible sets to lookup tables or `text` + `CHECK`. **Effort:** 3 days per set.
**Priority:** P3 — convert opportunistically when a set next changes, not as a project.

**ARCH-05 · No API, no webhooks, no integration surface · High (product) — see `PROD-09`**

**ARCH-06 · Inline server actions inside page components · Low**
The builder defines ~10 `"use server"` closures inside the page component. It works and keeps
related code together, but it couples action identity to the rendering module, complicates reuse and
unit testing, and means each action re-derives context independently. **Fix:** extract to
`actions.ts` per route (the pattern already used by `locations/` and `items/import/`). **Effort:**
2 days. **Priority:** P3.

### Operations

**OPS-02 · No dead-letter handling or job-failure alerting · Medium** — covered under `OPS-01`
item 5 and `PERF-02` item 4. After five retries a job is abandoned with no notification: a roster
publish email can be permanently lost with no signal. **Priority:** P1 (bundle with `OPS-01`).

**OPS-04 · No tenant-facing audit log · Medium**
`admin_activity` covers vendor actions only. Tenant-side, there is **no history of who changed
what**: `updateEntry` (`repository.ts:1402`), `deleteEntry` and `setEntryApproved` overwrite or
remove timesheet records with no trail, and roster, pay-rate and settings changes are equally
unrecorded. **Impact:** in a wage dispute or a Fair Work records request, Roster cannot show who
edited an employee's hours or when — while being the system of record for those hours. Record-keeping
obligations (Fair Work Regulations 3.33–3.34) expect accurate, retained time-and-wages records; an
unversioned, silently-editable record is weak evidence. It is also the first thing a suspicious
employee asks about. **Fix:** one append-only `audit_event` table (`actor`, `actor_type`, `business`,
`entity`, `entity_id`, `action`, `before`, `after`, `at`), written by the same repo decorator built
for `SEC-02` — one mechanism, two consumers — plus a per-record history view for timesheets.
**Effort:** 1.5 weeks (shared with `SEC-02`). **Priority:** P1. **Industry comparison:** every
payroll-adjacent platform has immutable timesheet audit history.

**OPS-05 · No feature flags · Medium**
Every change is a big-bang deploy; there is no way to dark-launch, canary, or kill a
misbehaving feature without a revert. Several recommendations in this report (RBAC audit mode, CSP
enforcement, the storage dual-write, the audit decorator) are materially safer behind a flag.
**Fix:** a minimal `feature_flag` table plus a per-org override and a typed accessor; no vendor
needed at this scale. **Effort:** 3 days. **Priority:** P1 — it de-risks everything sequenced after
it, which is why it appears early in the roadmap.

**OPS-06 · Single region · Medium**
`vercel.json` pins `regions: ["syd1"]`; the worker is one Railway container; Neon is one region.
Reasonable for an AU-first product, and honest. **Impact:** ~250–300 ms baseline latency for European
and North American users, and a regional outage is a total outage. **Fix:** document the posture
deliberately; when expanding, put read replicas and static/edge assets in-region first, keep writes
homed, and only then consider data residency partitioning (which enterprise EU buyers will ask for).
**Effort:** 3 weeks when needed. **Priority:** P3 until a non-AU customer signs.

### Product, UX and DX

These are gaps rather than defects. Consolidated here with severity as _competitive_ impact;
`PROD-01`–`PROD-14` are expanded with rationale in §7.

| ID      | Gap                                                                                | Sev    | Effort | Priority |
| ------- | ---------------------------------------------------------------------------------- | ------ | ------ | -------- |
| PROD-01 | No departments / areas / teams / cost centres                                      | High   | 2 wks  | P1       |
| PROD-02 | No positions or skills; `staff_member.role` is a free-text label only              | High   | 2 wks  | P1       |
| PROD-03 | No public holidays, break rules, min-rest, max-hours or fatigue rules              | High   | 3 wks  | P1       |
| PROD-04 | No attendance exceptions: late, early, no-show, missed break, unapproved OT        | High   | 2 wks  | P1       |
| PROD-05 | No demand forecasting, POS integration or labour-% targets                         | High   | 4 wks  | P2       |
| PROD-06 | AU-only timezones, hardcoded AUD, hardcoded `en-AU`, no i18n                       | High   | 4 wks  | P2       |
| PROD-07 | No PWA, no push notifications, no offline clock-in                                 | High   | 3 wks  | P2       |
| PROD-08 | No leave balances, accrual view, leave calendar or blackout dates                  | Medium | 3 wks  | P2       |
| PROD-09 | No public API, webhooks, API keys or developer documentation                       | High   | 4 wks  | P2       |
| PROD-10 | No shift bidding, bilateral swaps or auto-approval policies                        | Medium | 2 wks  | P3       |
| PROD-11 | No approval chains or delegation                                                   | Medium | 2 wks  | P2       |
| PROD-12 | Reporting is one labour report; no roster-vs-actual variance, no scheduled reports | Medium | 3 wks  | P2       |
| PROD-13 | No data-subject export or erasure workflow (Privacy Act / GDPR)                    | High   | 2 wks  | P1       |
| PROD-14 | No clock-out geofence; clock-out is unverified                                     | Medium | 1 wk   | P2       |

**UX-01 · Empty, loading and error states are incomplete · Medium** — see `PERF-09`. Add an
illustrated first-run empty state per surface (the derived getting-started card is a strong pattern
already — extend its spirit), skeletons, and inline field-level validation. Several actions currently
`return` silently on validation failure (e.g. `toggleAssign`), leaving the user with no feedback at
all. **Effort:** 1.5 wks. **Priority:** P2.

**UX-02 · Accessibility is unverified · Medium** — 97 `aria-label`, 77 `aria-hidden`, plus
`role="switch"/"menu"/"dialog"/"status"/"alert"`: the intent and the fundamentals are clearly there,
which is better than most. But there is **no automated a11y check and no screen-reader
verification**, and the highest-risk surface — the drag-and-drop board — is exactly the kind of
interaction that fails WCAG without a tested keyboard path. The tap-a-name editor is retained as the
keyboard path, which is the right instinct; it needs proving. **Fix:** `axe-core` in CI on key
routes, a manual VoiceOver/NVDA pass on the board, kiosk and `/me`, and an accessibility statement.
**Effort:** 1 wk + 3 days/quarter. **Priority:** P2 (P1 if any public-sector or enterprise buyer is
in the pipeline — VPAT requests arrive early).

**DX-01 · No API, no SDK, no sandbox, no developer docs · High** — see `PROD-09`. The audit brief
names developer experience as a differentiator; today there is no external surface at all.
**Priority:** P2, but see §7 for why this is a strategic bet rather than a feature.

---

## 7. Part D — Competitive position and product gaps

### Where Roster stands

Roster's positioning is unusual and, in the auditor's view, genuinely valuable: it is the only
product in this comparison set built primarily for **the owner who has never used scheduling
software**. The five-second-comprehension rule in `CLAUDE.md` is not marketing; it is visibly
enforced in the code — derived setup state instead of manual checkboxes, flags instead of blocks,
plain-language copy, no jargon. Deputy, UKG and Workday are all significantly harder to adopt.
**That is a real moat in the SMB hospitality segment and it should be protected deliberately, not
diluted as enterprise features arrive.** The single most important product-strategy conclusion of
this audit is: build the platform layer _underneath_ the simple surface, and let complexity be
opt-in.

Two decisions stand out as genuinely differentiated and worth doubling down on:

1. **The "flag, never block" philosophy.** Roster warns about understaffing, double-booking, leave
   conflicts and expiring certifications without ever preventing the owner from proceeding. Every
   competitor eventually blocks, and every one of them generates support tickets from managers
   fighting their own software at 6 pm on a Friday. This is a defensible design position.
2. **The hard payroll boundary.** Refusing to calculate wages — while still pushing draft
   timesheets and letting owners map hours onto _their own_ Xero pay items — sidesteps award
   interpretation liability entirely. Competitors carry enormous compliance risk here (Australian
   award interpretation has produced multiple public underpayment scandals). Roster's boundary is
   enforced structurally, in code, with guard tests. That is a story worth telling to buyers.

### Gap analysis

| Capability                | Deputy             | Tanda             | 7shifts                 | Rippling/Workday       | **Roster**                    |
| ------------------------- | ------------------ | ----------------- | ----------------------- | ---------------------- | ----------------------------- |
| Roles & permissions       | Granular groups    | Role-based        | By location             | Full ABAC + delegation | **One role**                  |
| Employee self-service app | Native iOS/Android | Native            | Native                  | Native                 | **None** (links + PIN)        |
| Departments / areas       | Yes                | Yes               | Yes                     | Yes                    | **No**                        |
| Skills-based rostering    | Yes                | Yes               | Partial                 | Yes                    | **No** (free-text label)      |
| Award interpretation      | Yes                | **Core strength** | US rules                | Global                 | Deliberately out of scope     |
| Demand forecasting        | Yes                | Yes               | **Core strength** (POS) | Yes                    | **No**                        |
| Auto-scheduling           | Yes                | Yes               | Yes                     | Yes                    | **No** (last-week draft only) |
| Break / fatigue rules     | Yes                | Yes               | Yes                     | Yes                    | **No**                        |
| Attendance exceptions     | Yes                | Yes               | Yes                     | Yes                    | **No**                        |
| Offline clock-in          | Yes                | Yes               | Yes                     | Yes                    | **No**                        |
| Public API / webhooks     | Yes                | Yes               | Yes                     | Yes                    | **No**                        |
| SSO / SCIM                | Yes                | Yes               | Yes                     | Yes                    | **No**                        |
| Multi-country / i18n      | Yes                | AU/NZ             | US/CA                   | Global                 | **AU only**                   |
| Ease of adoption          | Medium             | Medium            | Good                    | Poor                   | **Excellent**                 |
| Payroll liability posture | Carries it         | Carries it        | Carries it              | Carries it             | **Deliberately avoided**      |

**Reading of the table.** The gaps cluster into three tiers, and the sequencing matters more than
the list:

- **Tier 1 — market-access blockers** (roles, employee accounts, departments, compliance rules,
  attendance exceptions). Without these Roster cannot sell above ~5 venues, regardless of how good
  the UX is. These are the roadmap's Phase 2.
- **Tier 2 — competitive parity** (forecasting, auto-scheduling, offline, PWA/push, i18n, API).
  Needed to win against 7shifts and Deputy in a head-to-head, but not needed to _enter_ the deal.
- **Tier 3 — differentiation** (§8). Where Roster can lead rather than catch up.

### Specific product recommendations with rationale

**PROD-01/02 — Departments and positions.** These are prerequisites, not features: they are the
scoping dimension that makes RBAC useful (a manager manages a _department_), the axis that makes the
roster board tractable at 200 staff (`PERF-12`), and the input skills-based rostering needs. Model
`department` (per location) and `position` (per org, with a skill/certification requirement), then
give `shift` a `position_id` so "this shift needs a certified barista" becomes expressible. Keep it
optional — a single-venue café should never see a department picker.

**PROD-03 — Compliance rules, flag-first.** Public holidays, minimum rest between shifts, maximum
consecutive days, maximum weekly hours, mandatory break scheduling. Build it as the existing
insights engine does (`roster-insights.ts`): pure functions over the roster producing **warnings,
never blocks**, consistent with the product's philosophy. This is high customer value and low
liability precisely _because_ it does not interpret awards — it checks mechanical rules the owner
configures. It also positions the eventual "compliance validation" AI feature on real data.

**PROD-04 — Attendance exceptions.** Roster captures clock-in and roster data but never compares
them. Late arrivals, early departures, no-shows, missed breaks and unapproved overtime are all
derivable _today_ from existing tables with no new capture. This is the highest value-per-effort
product item in the report: a "roster vs actual" variance view plus an exceptions queue, from data
already in the database.

**PROD-13 — Data-subject rights.** Roster holds employee PII, biometric-adjacent photos and location
data. There is no self-serve export and no erasure workflow. Under the Privacy Act (and GDPR if any
EU staff exist) this is a live obligation, not a future one. Because `business_id` scoping is already
rigorous, a per-person export/erase job is comparatively cheap to build — and the photo retention job
already establishes the deletion pattern. Do it before it is requested under time pressure.

**PROD-09 / DX-01 — The API as strategy, not feature.** The brief asks where Roster can beat
competitors on _developer_ experience. Competitors' APIs are afterthoughts: inconsistent, poorly
documented, weakly versioned. A genuinely excellent API — resource-oriented REST with cursor
pagination, idempotency keys on every write (the Xero integration already implements this discipline
well and can be the internal model), signed webhooks with replay, an OpenAPI spec, generated SDKs,
and a sandbox tenant — is achievable here because the tenant repo already provides a clean internal
seam to expose. Given the Zale ecosystem ambition, the API is also the integration substrate for
Zale AI and any sibling app; prompt2eat SSO already proves the cross-app pattern works.

---

## 8. Part E — AI capability architecture

The brief asks for AI features. The most useful thing this audit can say is: **do not start with the
model.** Roster's AI opportunity is bounded by three things it does not yet have — a demand signal
(no POS integration), an outcome signal (no attendance exceptions, so "was this roster good?" is
unanswerable), and a preference signal (availability is per-shift yes/no with no history retained
across periods). Build those first; they are cheap, individually useful, and they are the actual
moat. A competitor can copy a prompt in a week; they cannot copy two years of labelled rostering
outcomes.

Equally important: **the roster generation problem is not a language-model problem.** It is
constrained optimisation. Using an LLM to assign shifts produces confident, unverifiable, subtly
non-compliant rosters. Use a solver for assignment, and use the LLM for the things it is genuinely
better at than any UI: explanation, natural-language editing, and summarisation.

### Phase A — the data foundation (prerequisite, ~6 weeks)

1. **Event log.** An append-only `domain_event` stream (shift created/moved/filled, offer released,
   claim made, clock-in, exception raised). This is the training substrate and doubles as the audit
   log from `OPS-04` — one mechanism, three consumers. Build it once.
2. **Demand signals.** POS integration (Square, Lightspeed, Toast) for hourly sales; weather by
   location; a local-events feed. Store as a per-location hourly time series.
3. **Outcome labels.** `PROD-04` exceptions become the label set: which rostered shifts were
   late, swapped, no-showed, or ran over.
4. **Preference signals.** Retain availability _history_ rather than discarding it per period, and
   derive revealed preference from claim/release behaviour — who actually picks up Sunday nights.

### Phase B — deterministic intelligence (no LLM, ~8 weeks)

5. **Demand forecast.** Per location, per hour: gradient-boosted trees on sales history + weekday +
   seasonality + weather + events. Start with a seasonal-naive baseline and only ship the model when
   it beats it on held-out MAPE — publish that number in the UI ("usually within 8%"). Honesty about
   accuracy is the trust mechanism.
6. **Roster generation as a solver.** CP-SAT (OR-Tools) as a service: minimise labour cost subject to
   coverage targets, availability, approved leave, certification validity, rest rules and fairness.
   **Emit the constraint set as explanation** ("Sam is here because they're the only certified
   closer available Friday") — this is where explainability comes free from the architecture rather
   than being retrofitted. Always produce a _proposal_ the owner approves; never auto-publish.
7. **Absence risk.** Per assignment: probability of no-show or late arrival, from history, shift
   timing, consecutive-days load and weather. Surface as a pre-publish flag, consistent with
   flag-never-block.
8. **One-click replacement ranking.** When someone calls in sick, rank candidates by availability,
   cost delta, rest compliance, certification, fairness and historical acceptance rate. This is the
   single highest-value AI-adjacent feature for a hospitality manager, and it needs no LLM.

### Phase C — language interfaces (LLM, ~8 weeks)

9. **Manager copilot.** Natural language over the roster: _"give Sarah Fridays off for the next
   three weeks and backfill from whoever's cheapest."_ Critically: the model emits a **structured
   diff**, the diff is validated by the same rules engine, and the manager approves it. Never let a
   model write to the database directly; make the diff reviewable, exactly like a code review. This
   architecture is also what makes the feature safe to ship.
10. **Roster explanation and what-if.** _"Why is Tuesday so expensive?"_ answered over the labour
    report and the solver's constraint trace — grounded in real numbers, never generated.
11. **Natural-language reporting.** Text to a validated query over a restricted schema, returning a
    real table plus the query for inspection. Bound the surface; never free SQL.
12. **Compliance explanation.** Turn a rule violation into plain language with the fix — again
    grounded in the deterministic engine's output, so the model narrates rather than decides.

### Phase D — genuine differentiation (5–10 year view)

13. **Roster review, like code review.** Diff two roster versions, with cost, coverage, fairness and
    compliance deltas, comment threads and approval. Nobody in this market treats a roster as a
    reviewable artefact; every manager already treats it as one informally.
14. **Fairness ledger.** Transparent, auditable distribution of desirable and undesirable shifts per
    person over time, visible to staff. Directly addresses the top driver of hospitality roster
    disputes, and no competitor offers it. High trust value, low technical cost.
15. **Wellbeing analytics.** Detect "clopening" (close then open), excessive consecutive days, night
    load, and schedule volatility — the measurable drivers of hospitality burnout and turnover. Frame
    it as retention analytics, which is what an owner buys.
16. **Digital twin simulation.** _"What if I open a second venue three suburbs away and share
    staff?"_ — Roster already has the staff-loan and cross-location primitives (M29 Phase 3/4) to
    model this credibly. That is an unusual head start.
17. **Schedule stability score.** Publish-to-shift lead time, change frequency and shift-swap churn
    per venue, benchmarked. Predictive-scheduling regulation is spreading internationally; being
    early here is both a compliance product and a differentiator.

### AI governance (non-negotiable, build with Phase B)

Human approval before any roster publishes; provenance recorded on every AI-influenced assignment
(the event log gives this); per-tenant opt-in with a clear data-use statement; **no training on one
tenant's data for another tenant's benefit without explicit consent** (say this in writing —
enterprise buyers ask); PII minimisation at the model boundary; published accuracy metrics with
graceful degradation to the deterministic path; and a documented "AI cannot" list mirroring the Xero
boundary discipline that already works well in this codebase.

### Zale ecosystem alignment

| Zale service       | Current state                        | Recommended path                                                                                                                             |
| ------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Zale DB**        | Neon Postgres, single region, no RLS | Add RLS (`SEC-15`); read replicas for reporting; partition `timesheet_entry`/`roster_assignment` by month past ~10⁸ rows                     |
| **Zale Storage**   | Absent — photos in `bytea`           | `BlobStore` interface now (`PERF-06`); swap the implementation when available. Also the home for future document upload beyond Drive         |
| **Zale Queue**     | pg-boss on the app database          | Keep pg-boss; introduce a `JobQueue` interface at the same time as the `PERF-02` fan-out so the migration is an adapter swap, not a rewrite  |
| **Zale Functions** | Single Railway worker                | Per-tenant job fan-out (`PERF-02`) maps directly onto function invocations; this is the main reason to do fan-out before the platform exists |
| **Zale AI**        | None                                 | Model-gateway interface + eval harness from day one; never call a provider SDK directly from feature code                                    |
| **Zale Hosting**   | Vercel `syd1` + Railway              | Document the current posture (`OPS-06`); multi-region when a non-AU customer signs                                                           |

The strategic point: **each of these should be introduced as an interface before the Zale service
exists.** `BlobStore`, `JobQueue` and `ModelGateway` are cheap to define now and turn a future
platform migration into an adapter implementation. The Google Drive integration
(`DriveClient` + a fake in tests) is already a working template for exactly this pattern.

---

## 9. Part F — Scale and cost model

Estimates from query shape, row-size arithmetic and the verified index inventory. **No load test or
`EXPLAIN ANALYZE` was run**, so treat these as sizing guidance to be validated, not measurements.

### Ceilings, in the order they will be hit

| Constraint       | Estimated ceiling          | Binding factor                                             | Fix       |
| ---------------- | -------------------------- | ---------------------------------------------------------- | --------- |
| Daily job sweeps | **~1,500–3,000 locations** | Serial loop, one job, `singletonKey` suppression           | `PERF-02` |
| Admin console    | **~500–1,000 orgs**        | Unbounded `max()` over `timesheet_entry`                   | `PERF-05` |
| Unindexed reads  | **~100k rows/tenant**      | Sequential scans on `roster_assignment`, `timesheet_entry` | `PERF-01` |
| Database size    | **~2–3 TB**                | Clock photos in `bytea`                                    | `PERF-06` |
| Roster board     | **~50–80 staff/location**  | Whole-period payload, no virtualisation                    | `PERF-12` |
| Connections      | **~10 × instances**        | pg default `max`, no explicit ceiling                      | `PERF-08` |
| Email throughput | Resend tier                | Serial sends, no concurrency control                       | `PERF-02` |

The ordering is the actionable part: **jobs break before the database does**, and the admin console
breaks before customers notice anything. Post-remediation, the architecture should reach roughly
10,000 locations / 500k employees before requiring partitioning or sharding — which is well beyond
the next two funding stages.

### Indicative infrastructure cost

Per 1,000 locations / ~50k employees, at list prices, current architecture vs remediated:

| Component        |             Current |        Remediated | Note                                           |
| ---------------- | ------------------: | ----------------: | ---------------------------------------------- |
| Postgres (Neon)  |       $800–2,000/mo |       $300–600/mo | Photos out of the DB; indexes cut CPU          |
| Object storage   |                  $0 |         $30–80/mo | ~1.2 TB photos at 90-day retention             |
| Web (Vercel)     |         $200–500/mo |       $150–400/mo | Fewer queries per request (`PERF-04`)          |
| Worker (Railway) |           $20–50/mo |       $100–300/mo | Deliberately more workers, parallel fan-out    |
| Email (Resend)   |         $100–300/mo |       $100–300/mo | Volume-driven                                  |
| Observability    |                  $0 |       $100–300/mo | Sentry + metrics — the cheapest insurance here |
| **Total**        | **$1,120–2,850/mo** | **$780–1,980/mo** | ~$0.02/employee/mo                             |

Remediation is **cost-negative**: moving photos out of Postgres and adding indexes saves more than
observability and extra workers cost. That is a straightforward argument for doing this work now
rather than later, and worth making to whoever approves the roadmap.

---

## 10. Part G — Implementation roadmap

26 milestones. Each is **independently deployable, ≤2 weeks, backward compatible**, and carries
explicit test and documentation requirements. Ordering minimises risk: safety and visibility first,
then foundations, then platform, then intelligence. Two engineers, ~10 months; effort assumes
familiarity with the codebase.

**Standing requirements for every milestone:** CI green (typecheck, lint, format, tests); new tests
for new behaviour; `CLAUDE.md` and `README.md` updated in the same PR; additive migrations only
(destructive changes run manually per the documented expand/contract procedure); feature-flagged
where behaviour changes for existing tenants.

### Phase 0 — Stop the bleeding (weeks 1–6)

| #   | Milestone                                                                       | Findings         | Tests required                                                | Docs                              |
| --- | ------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------- | --------------------------------- |
| 0.1 | Bind impersonation to session; clear on sign-out/sign-in; TTL → 30 min          | SEC-01           | Session-mismatch rejected; sign-out clears; expiry            | `CLAUDE.md` M37 invariants        |
| 0.2 | Dependency remediation + Dependabot + `npm audit` gate + CodeQL + SBOM          | SEC-04           | Full suite on upgrade; auth/kiosk/board smoke                 | Security policy + remediation SLA |
| 0.3 | Security headers + `robots`/`noindex` + `Referrer-Policy` (CSP report-only)     | SEC-05, SEC-08   | Header-assertion test per route class                         | README security section           |
| 0.4 | Index pack (`CONCURRENTLY`, outside the migration runner) + pool/timeout config | PERF-01, PERF-08 | `EXPLAIN` assertions; verify plans in prod                    | Appendix + runbook                |
| 0.5 | Fix job owner resolution (org membership) + cross-location notices              | COR-01, COR-02   | Two-location org receives both; cross-location notice visible | `CLAUDE.md` job section           |
| 0.6 | Health + readiness endpoints, worker heartbeat + staleness alert                | OPS-01 (1–2)     | Endpoint tests; simulated stale heartbeat                     | Ops runbook                       |
| 0.7 | PIN escalating backoff + weak-PIN blocklist + async scrypt + kiosk rate limit   | SEC-06, SEC-07   | Lockout escalation; blocklist; DoS regression                 | `CLAUDE.md` clock-in section      |
| 0.8 | Escape all email-template interpolation + allow-list `ctaUrl`                   | SEC-16           | Markup payload round-trips escaped; staff `quantity` path     | `CLAUDE.md` email section         |
| 0.9 | Second-pass audit over the unread surface (§3.1) — findings, not fixes          | §3.1             | n/a (review milestone)                                        | Audit revision 2                  |

### Phase 1 — Foundations (weeks 7–18)

| #    | Milestone                                                                           | Findings               | Tests required                                 | Docs                     |
| ---- | ----------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------- | ------------------------ |
| 1.1  | Error tracking + correlation ids + `error.tsx`/`global-error.tsx`                   | OPS-01, PERF-09        | Error-boundary render; PII scrubbing           | Ops runbook              |
| 1.2  | Queue metrics, DLQ, failure alerting                                                | OPS-01, OPS-02         | DLQ routing; alert fires                       | Ops runbook              |
| 1.3  | Feature flags (table + typed accessor + per-org override)                           | OPS-05                 | Flag on/off paths                              | `CLAUDE.md`              |
| 1.4  | Request-scoped context memoization                                                  | PERF-04                | Query-count assertion; cross-session isolation | `CLAUDE.md`              |
| 1.5  | Job fan-out: dispatcher + per-business jobs (start with photo retention)            | PERF-02                | Per-tenant idempotency; failure isolation      | `CLAUDE.md` job section  |
| 1.6  | Per-timezone scheduling + `digest_hour_local`                                       | PERF-03                | Multi-tz dispatch; DST boundary                | `CLAUDE.md`              |
| 1.7  | DR: document RTO/RPO, run a restore drill, write runbooks, staging + migration gate | OPS-03                 | Restore drill evidence; staging migration pass | New `docs/operations.md` |
| 1.8  | Audit infrastructure: `audit_event` + repo decorator (serves tenant + admin)        | OPS-04, SEC-02, SEC-03 | Every mutator logs; tamper resistance          | `CLAUDE.md`              |
| 1.9  | Retention job for unbounded tables + pg-boss archive config                         | PERF-10                | Per-policy deletion; idempotency               | `CLAUDE.md`              |
| 1.10 | `BlobStore` interface + photo dual-write + backfill                                 | PERF-06                | Fake-store flow; backfill resumability         | `CLAUDE.md`              |
| 1.11 | Postgres RLS, audit mode → enforced, table by table                                 | SEC-15                 | Isolation tests under RLS; deny-log empty      | `CLAUDE.md` tenancy      |
| 1.12 | Repository split by domain (mechanical, call sites unchanged)                       | ARCH-01                | Existing suite unchanged                       | `CLAUDE.md` layout       |

### Phase 2 — Platform and enterprise (weeks 19–34)

| #    | Milestone                                                                     | Findings       | Tests required                           | Docs                       |
| ---- | ----------------------------------------------------------------------------- | -------------- | ---------------------------------------- | -------------------------- |
| 2.1  | RBAC part 1: roles, location scoping, `can()` policy module in **audit mode** | ARCH-02        | Exhaustive policy matrix; deny-log empty | `docs/permissions.md`      |
| 2.2  | RBAC part 2: enforce; manager UI; scoped navigation                           | ARCH-02        | Per-role integration tests               | `docs/permissions.md`      |
| 2.3  | Employee accounts + invitations (capability links retained)                   | ARCH-03        | Account↔staff linking; link fallback     | `CLAUDE.md`                |
| 2.4  | Departments / areas + optional per-location structure                         | PROD-01        | Scoped reads; single-venue unaffected    | `CLAUDE.md`                |
| 2.5  | Positions + skills + certification requirements on shifts                     | PROD-02        | Requirement flagging (never blocking)    | `CLAUDE.md`                |
| 2.6  | Compliance rules engine: holidays, rest, max hours, breaks — flag-first       | PROD-03        | Pure rule unit tests; boundary cases     | `docs/compliance-rules.md` |
| 2.7  | Attendance exceptions + roster-vs-actual variance                             | PROD-04        | Derivation from existing data            | `CLAUDE.md`                |
| 2.8  | Data-subject export + erasure workflow                                        | PROD-13        | Completeness; cascade correctness        | `docs/privacy.md`          |
| 2.9  | i18n/l10n: locale, currency, global timezones                                 | PROD-06        | Locale snapshots; tz matrix              | `CLAUDE.md`                |
| 2.10 | PWA + push notifications + offline clock-in queue                             | PROD-07        | Offline queue replay; conflict handling  | `CLAUDE.md`                |
| 2.11 | Public API v1 + webhooks + API keys + OpenAPI                                 | PROD-09, DX-01 | Contract tests; webhook replay           | `docs/api/`                |
| 2.12 | Passkeys/MFA + session management UI                                          | SEC-11         | Enrolment, recovery, revocation          | `docs/security.md`         |

### Phase 3 — Intelligence (weeks 35–48)

| #   | Milestone                                                            | Findings   | Tests required                                              |
| --- | -------------------------------------------------------------------- | ---------- | ----------------------------------------------------------- |
| 3.1 | Domain event log (shared with 1.8) + preference/outcome retention    | AI Phase A | Event completeness                                          |
| 3.2 | POS + weather + events ingestion                                     | PROD-05    | Adapter tests against fakes                                 |
| 3.3 | Demand forecast with published accuracy vs naive baseline            | PROD-05    | Backtest harness; MAPE gate                                 |
| 3.4 | Solver-based roster generation (CP-SAT) with constraint explanations | AI Phase B | Constraint satisfaction; determinism                        |
| 3.5 | Absence risk + one-click replacement ranking                         | AI Phase B | Ranking regression on historical data                       |
| 3.6 | Manager copilot: NL → validated structured diff → human approval     | AI Phase C | Diff validation; refusal cases; prompt-injection resistance |
| 3.7 | Fairness ledger + wellbeing analytics                                | AI Phase D | Metric correctness                                          |

### Phase 4 — Scale (as demand requires)

Multi-region and read replicas (`OPS-06`); table partitioning; Zale Queue/Storage/AI adapter swaps;
SOC 2 Type II readiness; enterprise SSO (SAML/OIDC + SCIM).

### Sequencing rationale

Phase 0 is ordered by _risk retired per day of work_: a live security defect, a supply chain with
critical CVEs, a silent correctness bug, and the cheapest performance fix in the report. Phase 1
deliberately front-loads **observability and feature flags** because every subsequent milestone is
safer with them — the RBAC audit mode in 2.1, the CSP enforcement in 0.3, the RLS rollout in 1.11 and
the storage dual-write in 1.10 all depend on being able to see what is happening and turn it off.
Phase 2 is ordered so RBAC lands before anything that needs to be scoped by it. Phase 3 deliberately
comes last because its prerequisites are data, not models, and shipping AI features on absent
signals would produce demos rather than value.

---

## 11. Part H — What is genuinely excellent

An audit that only lists problems misrepresents the codebase and gives bad guidance about what to
preserve. These are patterns to keep and extend, not merely compliments:

1. **The tenant repository pattern.** One choke point, `businessId` injected rather than accepted,
   the cross-tenant exceptions named and confined to four small files with explicit comments
   explaining why each exists. This is why every fix in this report is additive rather than a
   rewrite, and it is worth understanding that debt avoided here is the reason the roadmap is
   10 months and not 24.
2. **Pure core, impure shell.** `draft.ts`, `pay-rules.ts`, `assignment-schedule.ts`,
   `labour-report.ts`, `order-reminder.ts`, `roster-insights.ts`, `certification.ts` are pure,
   deterministic and exhaustively unit-tested, with I/O kept at the edges. This is the main reason
   the test suite is fast and trustworthy.
3. **Idempotency as a first-class concern.** Every job has an explicit cursor
   (`sent_at`, `decision_notified_at`, `last_reminder_stage`, `last_order_reminder_date`,
   `dedupe_key`, `form_digest_last_at`), and every one advances **only after** a successful side
   effect. This is the single most-often-botched aspect of background work and it is right
   throughout.
4. **Structural boundary enforcement.** Choosing raw `fetch` over the Xero SDK so that forbidden
   methods _cannot exist_, then pinning the method set with a guard test, is a level of rigour I
   rarely see. `tests/pay-rules-boundary.test.ts` — asserting the migration inserts nothing and the
   code contains no award vocabulary — is exemplary: it tests a _product commitment_, not just code.
5. **Snapshot-versus-reference discipline.** `form_response_answer` snapshots the question label and
   type with `ON DELETE SET NULL` on the field, so history survives form edits. Concrete shifts
   snapshot label, times and staffing target. Someone thought carefully about which facts must
   outlive their source, which is a mark of real data modelling maturity.
6. **Documentation.** `CLAUDE.md` is the best artefact in the repository — decisions recorded _with
   their reasoning and their rejected alternatives_, including reversals (the Xero 1.0→2.0
   correction). The plan docs are equally strong. This materially reduced audit time and would do
   the same for onboarding.
7. **Correct crypto choices.** SHA-256 for capability tokens with only hashes stored; salted scrypt
   for PINs; AES-256-GCM with fresh IVs and verified auth tags for OAuth tokens; `timingSafeEqual`
   throughout; versioned ciphertext; fail-closed configuration gates. The `SEC-01` finding is an
   _architectural_ mistake about what the token is bound to, not a cryptographic one.
8. **Migration hygiene.** 34 sequential additive migrations, destructive changes explicitly excluded
   from automation with the expand/contract requirement documented in the CI file itself, and a
   serialised `concurrency` group that must never cancel mid-apply. Better than most teams manage.
9. **Timezone correctness in the data layer.** UTC storage, business-local formatting, calendar
   dates as strings where they are genuinely date-only, and a single shared `formatTimeRange` that
   handles overnight shifts. The overnight-shift work (M34) on the extended minute axis is subtle
   and appears correct. `PERF-03` is about _scheduling_ time, not this.
10. **Product judgement.** Flag-never-block, derived setup state instead of manual checkboxes, the
    refusal to calculate wages, the insistence that a target is a target. These are opinions held
    consistently, and consistency is what makes a product feel coherent.

---

## 12. Open questions for the team

Answers change the sequencing above, and I would want them before committing the roadmap:

1. **Neon configuration** — is PITR enabled, and what is the retention window? `OPS-03`'s effort
   estimate assumes it exists and needs documenting rather than building.
2. **Is `next-auth@5` stable available?** If not, `SEC-04` becomes a documented accepted risk with a
   monitoring plan rather than an upgrade.
3. **Target market for the next 12 months** — if it is single-venue AU cafés, Phase 2 can slip and
   Phase 3 can pull forward. If it is 5–50 venue groups, RBAC (2.1/2.2) should move into Phase 1.
4. **Is any non-AU customer in the pipeline?** That promotes `PROD-06` and `PERF-03` sharply.
5. **Zale platform timelines** — when Storage, Queue and AI land determines whether `PERF-06` and
   `PERF-02` build adapters now or targets now.
6. **`admin_activity` retention requirement** — is there a contractual or regulatory floor? It sets
   the `PERF-10` policy.
7. **Appetite for a data-model change to `staff_member` identity** (`COR-03`)? De-duplication needs a
   product decision about merging, and the cost of delay is real.

---

## 13. Appendix

Ready-to-apply remediation snippets — index DDL (with the `CONCURRENTLY` caveat), the security-header
configuration, the session-binding patch for `SEC-01`, the org-aware owner resolver for `COR-01`, and
the job dispatcher sketch for `PERF-02` — are in
[`docs/platform-audit-2026-07-appendix.md`](./platform-audit-2026-07-appendix.md).

---

_Prepared by an independent architecture, security, performance and product review. Findings are
grounded in the revision cited above; file and line references are to `c52bd50`. Performance
findings are derived from query shape against the verified index inventory and should be confirmed
with production query plans before and after remediation._
