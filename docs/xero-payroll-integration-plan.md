# Xero Payroll AU integration — approved build plan

Status: **approved, build in progress on branch `xero-payroll`.** This document
is the plan of record captured across review. It is **not** a payroll product —
see §1. Nothing here is built until it appears in the source; this doc precedes
the code.

Prerequisites reused from the existing codebase (all present at this branch's
base): `src/lib/crypto.ts` (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`), the Google
Drive OAuth pattern (`/api/integrations/google/*`, `google_drive_connection`,
the mockable `DriveClient` + `service.ts` orchestration), and the existing
timesheet **approval gate** (`timesheet_entry.approved`, `setEntryApproved`,
`listApprovedEntriesForExport`).

---

## 1. The hard boundary (non-negotiable) — and why it is held

**Roster never calculates or processes pay. This integration does not change
that.** It is a one-way "hand the reviewed hours over to Xero as a draft" pipe,
never a payroll engine. Concretely:

- **Only ever create Xero _Timesheets_ with `Status: DRAFT`.** A draft timesheet
  is inert — only an **Approved** timesheet is auto-pulled into a Xero pay run,
  and approval happens inside Xero by a human. So the worst a Roster bug can do
  is create a wrong _draft_ that a human catches; it can never move money.
- **No capability to create/post a Pay Run — enforced three ways:**
  1. **No code** — the `XeroPayrollClient` interface (§7) exposes no pay-run method.
  2. **No scope** — we never request `payroll.payruns`, so the token cannot POST
     a pay run. **Xero mandated granular OAuth scopes for all apps created after
     2 March 2026, retiring the old bundled scopes entirely**, so a new app has
     _no path_ to a bundled payroll scope — the no-payruns guard is enforced by
     Xero's own authorization server, not just app convention.
  3. **Read-only employee scope** — `payroll.employees.read` means the app
     **cannot write employee bank details, TFN/tax declarations, or super**,
     even if code existed.

**Why hold it:** Roster's product scope (CLAUDE.md) deliberately keeps it out of
payroll ("the app only records hours and a rate the owner typed… never a payroll
calculation"). Finalising pay is an irreversible financial + legal action
(payment, ATO STP filing, payslips). Keeping a licensed human (owner/bookkeeper)
doing that step _inside Xero_ preserves Roster's compliance posture and
guarantees human review before money moves.

**Two independent gates protect every push:**

1. **Roster gate** — only `approved` (owner-signed-off), closed hours are eligible.
2. **Xero gate** — everything lands as `DRAFT`; a human approves + runs pay in Xero.
   Neither replaces the other.

---

## 2. Xero Payroll AU — verified API facts

> **⚠️ SUPERSEDED for timesheets — the build uses Payroll 2.0.** The 1.0 facts
> below (§2 lead bullets + §2a) are retained as the original verification record;
> the timesheet client was switched to **AU Payroll 2.0** (ISO dates,
> `payrollCalendarID`, per-day scalar lines, title-case `Draft`, real `DELETE`).
> See the reversal block after §2a and the decision history in §2b. The OAuth /
> connection / `Xero-Tenant-Id` / `GET /connections` facts here are unchanged and
> version-independent.

- **Separate API:** base `https://api.xero.com/payroll.xro/1.0/` (Accounting is
  `api.xro/2.0`). By default apps get accounting only; payroll needs its scopes.
- **Authorising user must be a payroll administrator** (plus Standard/Adviser +
  Connected Apps). This is why the delegated bookkeeper flow exists (§6).
- **`Xero-Tenant-Id` header** on every call; obtained from `GET
https://api.xero.com/connections` after auth.
- **One connection covers Accounting + Payroll** (both "organisation" tenant
  type; scopes additive) — a later Accounting build can re-authorise the _same_
  `xero_connection` row.
- **Timesheets:** `POST /Timesheets` with `EmployeeID`, period (`StartDate`/
  `EndDate` aligned to the employee's payroll calendar), `Status` (we hard-code
  `DRAFT`), and `TimesheetLines` (`EarningsRateID` + per-day `Date` +
  `NumberOfUnits`).

> **First build step — source-verify against the live docs** (they 403 automated
> fetch, so the above is from Xero's indexed docs): exact field casing, the
> **delete-timesheet mechanism** (HTTP `DELETE` vs `POST status=DELETED` for AU),
> the **`Idempotency-Key` header + retention window**, the exact granular AU scope
> strings, and the employee / earnings-rate / payroll-calendar response shapes.
> These are confirmed before the client is finalised and reported at merge.

### 2a. Source-verified against the official Xero OpenAPI spec + generated SDKs

Verified from the authoritative machine-readable contract — the XeroAPI
`Xero-OpenAPI` spec and the generated `xero-node` (`payroll-au`) / `xero-python`
(`payrollau`) models — since the HTML docs 403 automated fetch:

- **Timesheet verbs (AU Payroll 1.0):** `create_timesheet` = **POST /Timesheets**;
  `update_timesheet` = **POST /Timesheets/{TimesheetID}**; `get_timesheet` = GET
  /Timesheets/{TimesheetID}; `get_timesheets` = GET /Timesheets. **There is NO
  `delete_timesheet` — the AU Payroll 1.0 API has no DELETE verb for timesheets,
  and no `DELETED` status.** (See the cancel note below — this changes the
  approved DELETE-based cancel.)
- **`TimesheetStatus` enum (verbatim, exhaustive):** `DRAFT`, `PROCESSED`,
  `APPROVED`, `REJECTED`, `REQUESTED`. **No `POSTED`, no `DELETED`.** We only ever
  send `DRAFT`.
- **`Timesheet` fields (exact JSON casing):** `TimesheetID`, `EmployeeID`,
  `StartDate`, `EndDate`, `Status`, `Hours`, `TimesheetLines`, `UpdatedDateUTC`,
  `ValidationErrors`.
- **`TimesheetLine` fields:** `EarningsRateID` (string), `TrackingItemID`
  (string, optional), **`NumberOfUnits` — an ARRAY of numbers, one entry per day
  of the `StartDate…EndDate` period** (NOT a single number). So a 7-day weekly
  period is a 7-element array of that day's hours.
- **Date format:** Xero's proprietary MS-JSON `"/Date(<epoch-ms>)/"` (e.g.
  `"/Date(1573621523465)/"`), NOT ISO — the client must serialise `StartDate`/
  `EndDate` in this form.
- **Read methods confirmed:** `get_employees` / `get_employee` (GET /Employees…),
  `get_pay_items` (GET /PayItems → earnings rates), `get_payroll_calendars` /
  `get_payroll_calendar` (GET /PayrollCalendars…). The employee's ordinary
  earnings rate is read from the employee `PayTemplate`; the calendar drives the
  period — **exact `PayTemplate`/`EarningsRates`/calendar sub-shapes are locked at
  the mapping stage (§ build seq) before mapping code depends on them.**

> **CANCEL + API-VERSION — REVERSAL, corrected with a dated primary source.**
> An earlier revision of this doc claimed there is "no AU Payroll 2.0 timesheet
> surface" and that AU orgs are "region-blocked from 2.0 entirely." **That was
> WRONG.** It was sourced from the wrong SDK module — `xero-python`'s `payrollau`
> binding, which is the **pre-March-2026, 1.0-specific** binding — not the surface
> the update shipped on. The owner reconciled it against Xero's own **dated
> changelog entry (6 March 2026, unretracted): "AU Timesheets in the Payroll 2.0
> API"** — a primary source I could not reach (developer.xero.com 403s automated
> fetch; the Wayback Machine is blocked here). **AU Payroll 2.0 timesheets are
> real**, and with them the originally-approved **real `DELETE`** is back on the
> table.
>
> **AU 2.0 wire shape — verified today from the fetchable primary artifacts**
> (the generated `xero-node` `payroll-nz` 2.0 models, which are the UNIFIED 2.0
> contract AU joined):
>
> - **`Timesheet`:** `{ timesheetID?, payrollCalendarID (required), employeeID
(required), startDate, endDate, status, totalHours?, timesheetLines[] }`.
> - **Dates are ISO `YYYY-MM-DD` strings** (NOT the 1.0 MS-JSON `/Date()/`).
> - **`TimesheetLine`:** `{ date (ISO YYYY-MM-DD), earningsRateID, numberOfUnits
(SCALAR number), trackingItemID? }` — **one line PER DAY**, versus 1.0's
>   single line with `NumberOfUnits: number[]`.
> - **`status` enum (2.0):** `Draft`, `Approved`, `Completed`, `Requested`
>   (title-case — so we hard-code `"Draft"`, not 1.0's `"DRAFT"`).
> - **Lifecycle endpoints (stable NZ/UK 2.0 contract):** `POST /Timesheets`,
>   `GET /Timesheets/{id}`, `POST /Timesheets/{id}/Lines` (+ line PUT/DELETE),
>   **`DELETE /Timesheets/{id}`** (the real cancel), **`POST /Timesheets/{id}/Approve`**,
>   **`POST /Timesheets/{id}/RevertToDraft`**. Base is `payroll.xro/2.0`.
>
> **⚠️ Still to confirm before building 2.0 (behind the 403 for me; the owner has
> doc access, or confirm at first live AU connect):** (1) the exact AU-2.0 base
> path + whether AU mirrors the unified shape 1:1 or adds AU-specific fields; and
> (2) **the OAuth scope** — whether `payroll.timesheets` alone covers AU 2.0 or a
> version-specific scope is required. Low risk to adjust: **no one has connected
> yet**, so there is no re-consent to manage — we just set the right scope before
> first connect.
>
> **Boundary on 2.0 is BIGGER and must be honoured:** 2.0 exposes `Approve` +
> `RevertToDraft`. The narrow client must EXCLUDE both as deliberately as pay-runs
> (approving a timesheet = finalising pay classification — a boundary breach),
> with a guard test asserting no such method exists (mirroring the pay-run guard).
>
> **Rework cost if we switch (sized against what's already built + tested):**
> BOUNDED. Changes touch only `src/lib/xero/client.ts` timesheet methods
> (2.0 base path, ISO dates, per-day scalar lines, `payrollCalendarID`, status
> `"Draft"`, ADD real `deleteTimesheet`) + `src/lib/xero/tokens.ts` (2.0 base
> const; timesheets stop using `toXeroMsDate`) + their two tests (+ the new
> Approve/Revert guard test) + possibly the `XERO_SCOPES` constant. **UNCHANGED:**
> the migration/schema (all GUID/date/double columns are version-agnostic), the
> connection service + OAuth client methods (OAuth is identical across versions),
> the delegated invite, and `crypto`. The employee/earnings/calendar reads (#15)
> and the aggregation-to-lines (#16) are **not built yet**, so targeting 2.0 there
> is a build choice, not rework — the aggregation just emits per-day lines.
>
> **DECISION — SWITCHED TO 2.0 (owner-approved).** The owner approved the switch.
> The timesheet client is now built on AU Payroll 2.0 with the originally-approved
> real `DELETE` cancel (guard it's still `Draft` → `DELETE /Timesheets/{id}`; else
> `XeroTimesheetAlreadyActioned`). The Option A zero-out workaround is dropped.
> Base path + scope are isolated to two named constants locked at first live
> connect; if an AU-specific quirk appears there, the bounded blast radius keeps
> the fix inside the timesheet client.

### 2b. Decision history (kept deliberately — a record of how this was decided)

This sequence is retained, not cleaned up: it is a legitimate record of how the
API-version decision was actually reached, including a wrong turn and its
correction against a dated primary source.

1. **Initial (1.0 assumption + workaround).** Built the client on AU Payroll
   1.0. Source-verify (from the `xero-python` `payrollau` SDK) showed 1.0 has no
   delete-timesheet and no `DELETED` status, so the approved DELETE cancel wasn't
   possible on 1.0 → owner chose **Option A** (guard-then-zero-then-mark-cancelled).
2. **Discrepancy found.** Owner recalled a Xero changelog entry announcing AU
   timesheets on Payroll 2.0. First 2.0 check (also from the `payrollau` module)
   still showed only create/get/update — and I **overreached**, writing that AU
   orgs are "region-blocked from 2.0 entirely."
3. **Overreach corrected.** Re-examined: `payrollau` is the **pre-March-2026,
   1.0-specific** binding — the wrong module to judge a 2.0 feature by. I could
   not reach the primary docs (developer.xero.com 403s; Wayback blocked here) and
   said so rather than assert a retraction I couldn't find; downgraded the claim
   to "unconfirmed."
4. **2.0 confirmed real via a dated primary source.** Owner fetched the changelog
   directly: **"AU Timesheets in the Payroll 2.0 API", 6 March 2026, unretracted.**
   AU Payroll 2.0 timesheets are real.
5. **2.0 wire shape verified + switched.** Verified the unified 2.0 shape from the
   fetchable generated SDK models (ISO dates, `payrollCalendarID`, per-day scalar
   `numberOfUnits`, title-case `Draft`, `{ timesheet }` envelope, DELETE + Approve
   - RevertToDraft lifecycle). Rebuilt the timesheet client on 2.0; excluded
     `Approve`/`RevertToDraft` with a guard test (as deliberately as pay-runs);
     restored the real `DELETE` cancel. **The base path + scope are the ONE pair of
     details not confirmable from the fetchable sources** — isolated into two named
     constants (`XERO_TIMESHEET_BASE_PATH`, `XERO_TIMESHEET_SCOPE`) to be **verified
     live** at the first AU demo-company connect, not guessed from docs that proved
     unreliable on this specific point across three checks.

Scopes: still requested as below; the `scope` field of the token response is
stored as `authorised_scopes` and audited to prove `payroll.payruns` was never
granted.

Scopes requested: `openid profile email offline_access payroll.timesheets
payroll.employees.read payroll.settings.read` — **never `payroll.payruns`**.

---

## 3. Data model (additive migration; every table `business_id`-scoped)

- **`xero_connection`** (one per business, UNIQUE `business_id`; mirrors
  `google_drive_connection`): `xero_tenant_id`, `org_name`,
  `connected_account_email`, `access_token_enc`, `refresh_token_enc`,
  `token_expiry`, `authorised_scopes`, `needs_reconnect`, **`status`
  (`pending_confirmation` | `active`)**, audit snapshot
  (`connected_via_invite_id?`, `connected_ip?`, `connected_user_agent?`,
  `confirmed_by_user_id?`, `confirmed_at?`), timestamps.
- **`xero_employee_map`**: `staff_member_id` (unique/business), `xero_employee_id`,
  `xero_employee_name` (snapshot), `earnings_rate_id` (nullable until resolved),
  `payroll_calendar_id` (snapshot), timestamps.
- **`xero_timesheet_push`** (audit + idempotency): `staff_member_id`,
  `xero_employee_id`, `period_start`, `period_end`, `xero_timesheet_id`,
  `status` (`draft` | `failed` | `cancelled`), `hours_total`, `payload_hash`,
  `idempotency_key`, `pushed_at`. **UNIQUE `(business_id, staff_member_id,
period_start, period_end)`.**
- **`xero_connect_invite`** (delegated link, §6): `token_hash` (UNIQUE),
  `sent_to_email`, `created_by_user_id`, `created_at`, `expires_at`,
  `consumed_at?`, `consumed_ip?`, `consumed_user_agent?`, `revoked_at?`.

Only the **hash** of any token is ever stored; raw tokens live in links/cookies.

---

## 4. OAuth connect flow (owner path — mirrors Google Drive)

`GET /api/integrations/xero/connect` (owner session OR the delegated
connect-context cookie, §6; fail-closed via `isXeroConfigured()`) → CSRF `state`
nonce in a short-lived httpOnly cookie → Xero consent (scopes above). `GET
/api/integrations/xero/callback` verifies `state`, exchanges the code, resolves
`Xero-Tenant-Id` + `org_name` via `GET /connections`, stores **encrypted** tokens
via `completeXeroConnection`, and creates the connection as
**`pending_confirmation`** (§8). Refresh + revoke→reconnect mirror
`ensureFreshAccessToken` / `needs_reconnect` on `invalid_grant`. All failures →
`/app/settings?xeroError=…` (friendly, never crashes). Token storage reuses
`crypto.ts` exactly; new `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` /
`XERO_OAUTH_REDIRECT_URI` are optional in `env.ts`, fail-closed.

**Payroll-admin error copy** (when the authorising Xero user lacks payroll admin):

> This Xero connection needs to be approved by someone with payroll admin access.
> Ask your bookkeeper or accountant to complete this step if that's not you.

---

## 5. Locked decisions

- **(a) Earnings rate** — auto-resolved from the employee's Xero pay template,
  **shown + editable on the pre-push preview** (same confirm-a-suggestion pattern
  as employee mapping). Unresolved ⇒ that employee is blocked from push.
- **(b) Pay period** — **auto-aligned to the employee's Xero payroll calendar; no
  arbitrary owner-picked date range.** The owner picks _which_ calendar period;
  the app derives `StartDate`/`EndDate` from that calendar. Staff on different
  calendars push as separate, correctly-dated timesheets.
- **(c)** All hours push under a **single ordinary earnings rate**; overtime/
  penalty/weekend rates are **not** classified (consistent with "no award
  interpretation") and are the human's job in Xero.
- **(d)** Roster **leave is record-only and not pushed** to Xero.

---

## 6. Delegated "Connect Xero" link (remote bookkeeper)

**Why:** Xero authorisation is decoupled from Roster identity — the API acts on
behalf of whoever authorises, and payroll scopes require _that_ Xero user to be a
payroll admin. But our callback derives `businessId` from the owner session, so a
remote bookkeeper on their own device (the café norm) can't complete it. The
delegated link closes that gap.

**Chosen approach: a dedicated single-use token + table** (`xero_connect_invite`),
not a signed-`businessId`-in-`state`. Rationale: single-use, revocation, and audit
_inherently require durable server state_, which the stateless `state` param
cannot provide; and it matches the codebase's established hashed-capability-token
pattern (kiosk/notices/availability/`sso_consumed_tokens`). `businessId` travels
through the OAuth roundtrip in a **short-lived, AUTH_SECRET-signed, httpOnly cookie
path-scoped to `/api/integrations/xero/*`** — never in the URL/`state`, keeping the
payroll-linked id out of logs. The invite grants **nothing except completing this
one business's Xero connect** — no Roster session, no other access.

**Lifecycle / properties:** owner mints from Settings (owner-session action only),
enters the bookkeeper's email, Roster emails the link. Bookkeeper opens it on
their own device → invite route validates → drops the connect-context cookie →
hands off into the existing connect→Xero→callback flow (bookkeeper logs into
_their own_ Xero and consents). **Single-use**, **72h expiry** (bookkeepers
routinely don't action same-day), **owner-mintable only**, **revocable /
regeneratable** (regenerate = revoke old + mint new). Only the token hash is
stored.

**Atomic consumption (required):** the callback consumes the invite with a single
race-free statement, **not** SELECT-then-UPDATE:

```sql
UPDATE xero_connect_invite
   SET consumed_at = now(), consumed_ip = $2, consumed_user_agent = $3
 WHERE id = $1
   AND consumed_at IS NULL
   AND revoked_at IS NULL
   AND expires_at > now()
RETURNING id;
```

Exactly one row affected ⇒ proceed; zero ⇒ the invite was revoked / already
used / expired **between opening the link and finishing Xero's consent screen**,
so the connection is refused. This closes two real gaps: a revoke issued
mid-flow actually stops completion, and two concurrent completions can't both
succeed.

---

## 7. The narrow client (`XeroPayrollClient`, mockable like `DriveClient`)

Exposes **only**: `buildAuthUrl`, `exchangeCode`, `refreshAccessToken`,
`getConnections`, `listEmployees` (read), `getEmployee` (read — pay template /
earnings rate / calendar), `listEarningsRates` (read), `listPayrollCalendars`
(read), `createDraftTimesheet` (**`Status` hard-coded `DRAFT`; takes a
deterministic `idempotencyKey`**), `getTimesheet` (read), **`cancelDraftTimesheet`**
(removes a timesheet **only while `DRAFT`**; throws a typed
`XeroTimesheetAlreadyActioned` → surfaced as "Already actioned in Xero — not
removed. Manage it in Xero."), `revoke`.

**Idempotency key:** `sha256("roster:" + business_id + ":" + staff_member_id +
":" + period_start + ":" + period_end)`, sent as Xero's `Idempotency-Key` header
on every create/update, so a double-click / retry is de-duplicated **at Xero
before a second draft exists** — the DB unique constraint is the durable
long-window guard behind it.

**Deliberately NOT used (no method, no scope where noted):** `POST`/`PUT` Pay
Runs (no method, no `payroll.payruns` scope); `POST`/`PUT` Employees (no bank /
TFN / super writes; read-only scope); approving a timesheet (human does it in
Xero); Payslips; Leave Applications write; Superfunds write; STP filing;
PayItems/Settings write. A **guard test** asserts the interface has no pay-run /
employee-write method (locks the boundary in CI).

---

## 8. Push, cancel, and owner confirmation

**Post-connection confirmation (link-interception catch):** the connection is
stored **`pending_confirmation` — not eligible for any push**. The owner (back in
their own session) sees _"Connected: **{Org Name}** ({email}). Is this your Xero
organisation?"_ and must click **"Yes — activate"** (records
`confirmed_by_user_id` + `confirmed_at`, flips `status = active`). If a link were
intercepted and the wrong org connected, the owner sees an unfamiliar org name and
rejects it (disconnect + regenerate). The push pipeline hard-checks `status =
active`. This also cleanly separates the two humans: bookkeeper _authorises_,
owner _confirms/activates_.

**Push (owner-initiated only; no cron):** eligible = `approved`, closed entries
(`listApprovedEntriesForExport(period)`) for **mapped** staff with a resolved
earnings rate, in the **calendar-aligned** period. Pure, unit-tested aggregation
(`src/lib/xero/timesheet-lines.ts`): approved entries → hours per staff per day →
`TimesheetLines` (single ordinary rate, 2dp to match the CSV/report). Per
employee → `createDraftTimesheet` (DRAFT + idempotency header); store
`xero_timesheet_id`. Re-push updates the draft; if Xero reports it already
`APPROVED`/`PROCESSED`, **do not overwrite** — "already processed in Xero." Skips
(unmapped / no rate / open / unapproved) are shown, never silently dropped.

**Cancel:** per pushed row, "Remove draft from Xero" → `cancelDraftTimesheet`
(DRAFT-only; typed already-actioned error); on success `xero_timesheet_push` →
`cancelled`.

**Confirmation banner (single-rate caveat — shown on the pre-push preview _and_
after the push):**

> **Draft timesheets created in Xero.** All hours were sent under a **single
> ordinary earnings rate** — Roster does **not** classify penalty, overtime, or
> weekend rates. **Review each timesheet in Xero, apply any penalty/overtime
> adjustments, then approve and run pay in Xero.** Roster never finalises pay.

---

## 9. Owner UI

- **Settings → Xero card:** connect / **invite your bookkeeper to connect** /
  `pending_confirmation` activate-with-org-name / reconnect / disconnect.
- **Mapping screen:** each active staff → suggested Xero employee (confirm);
  unmatched flagged + excluded; earnings rate shown + editable.
- **Timesheets → push panel:** pre-push preview (single-rate caveat, editable
  earnings rate, per-staff blockers) + post-push results (per-staff timesheet id +
  Xero deep link + skips) + the banner above + the payroll-admin error copy.

All UI uses the redesigned `src/components/ui.tsx` kit.

---

## 10. Build sequence & testing

Sequence: **plan doc (this file)** → source-verify live Xero details → migration

- schema → connection service + crypto reuse → delegated invite (mint + atomic
  consume + confirm) → narrow client + fake → mapping + earnings rate → push (draft,
  approved-only) + cancel → owner UI → tests.

Tests: fake `XeroPayrollClient`; unit tests for aggregation, idempotency-key
derivation, the atomic-consume guard, cancel's DRAFT-only guard, mapping
resolution; a connect→map→push→cancel flow test; and the boundary guard test
(no pay-run / employee-write method). Then `typecheck` / `lint` / `prettier` /
`build`, and a **merge-readiness report** with the live-API verification results
before merge.
