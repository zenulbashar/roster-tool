# Multi-location & cross-location staffing — plan of record

**Status: PROPOSED (M29)** — research done, plan drafted for owner review. NOT
yet authorized to build. This is a deliberate, owner-requested **expansion of
the MVP boundary**: CLAUDE.md today defines the product as *one owner = one
business = one tenant*, and lists **cross-tenant** and **bilateral swaps** as
out of scope. This feature knowingly crosses that line. Approving the build
means updating CLAUDE.md's "Product scope" + "Non-negotiable conventions"
sections in lock-step (see §12).

## 0. What this is (and is not)

Let one **owner account** manage **several locations** (cafés/venues) and move
staff between them.

The owner asked for, and this plan targets (confirmed via clarifying questions):

1. **Add multiple locations** under a single owner's access.
2. **One linked staff identity** across locations (an employee who works at two
   venues is *one* person, not two unrelated profiles).
3. A **shared, org-wide staff pool** — staff (and their pay) are managed once at
   the org level, not re-typed per location.
4. **Both** kinds of "swap": (a) single-shift **cross-location cover** (extend
   the existing release → claim → owner-approve flow across locations), and (b)
   owner-initiated **lending / move** of a person to another location for a date
   range.

**This is NOT** (kept out, consistent with the app's philosophy):

- **NOT** a rewrite of per-location tenancy. Each **location stays its own
  tenant** (`business` row, `business_id` scoping). The org layer sits *above*
  it; it never dilutes per-location isolation. (See §4 — this is the single most
  important architectural choice.)
- **NOT** bilateral A↔B auto-swaps. Every cross-location handover is still
  **owner-approved**, one-directional (release/claim or owner-assign). No
  auto-approval.
- **NOT** cross-*org* anything. Sharing is only ever **within one owner's org**.
  A location can never see or borrow from a location it doesn't share an org
  with. This is the new crown-jewel invariant (§5).
- **NOT** payroll/award changes. Pay is still a stored number + label; hours are
  recorded where the work happened. Xero stays per-location, draft-only.
- **NOT** multi-owner org governance in v1 (roles/permissions beyond "owner").
  The membership table is designed to allow it later, but v1 ships single-role.

## 1. Verified foundations (current architecture, confirmed on this branch)

Facts that shape the plan, each checked in the code:

1. **One owner ⇄ one business, hard-wired in three places.**
   - `user.businessId` is a single nullable FK (`src/lib/db/schema.ts:117`),
     set once at onboarding (`src/app/onboarding/page.tsx:44-52`) or by SSO
     provisioning.
   - The session carries a single `session.user.businessId`
     (`src/lib/auth/index.ts:69-76`).
   - `requireOwner()` / `ownerRepo()` read that one id and build
     `createTenantRepo(businessId)` (`src/lib/auth/context.ts:39-54`).
2. **Tenancy is centralised and clean.** `createTenantRepo(businessId)`
   (`src/lib/tenant/repository.ts:82`) *injects and filters* `business_id` on
   every domain read/write. ~37 owner pages/actions under `src/app` go through
   `ownerRepo()`/`requireOwner()`. **This is the asset we must preserve** — if
   "location" == today's `business`, none of those queries change.
3. **Staff are per-business.** `staff_member.business_id` NOT NULL
   (`schema.ts:305`), unique on `(business_id, email)` (`schema.ts:339`). PIN,
   capability tokens (`notices_token_hash`), pay rate, lockout counters all hang
   off the per-business staff row. Every domain table that references a person
   (`availability_*`, `roster_assignment`, `timesheet_entry`, `leave_request`,
   `shift_offer`, `staff_certification`, `stock_check_entry`,
   `staff_notification`, `staff_document`, `xero_employee_map`) points at
   `staff_member.id`. **Touching that FK touches everything.**
4. **Shift swaps are single-business by construction.** `shift_offer` is
   business-scoped; `approveOffer` (`repository.ts:1872`) runs in one
   transaction that assigns a `roster_assignment` whose `staff_member_id` and
   `shift` are *the same business*. The releaser/claimer are same-business staff
   (`src/lib/shift-offer-submission.ts`). Staff surfaces (`/clock`, `/kiosk`)
   resolve the business from a **per-business capability token**, never client
   input (`src/lib/tenant/kiosk-access.ts`, `personal-clock-access.ts`).
5. **No `organisation` or `location` concept exists yet.** Confirmed: no such
   table, no grouping above `business`.

**Design consequence:** the cheapest, safest way to deliver everything the owner
asked for is to **keep `business` as the per-location tenant unit unchanged**,
add an **`organisation`** above it, and add a **shared `person`** identity that
*links* the existing per-location `staff_member` rows — rather than collapsing
staff into one org-level row (which would rewrite every FK in fact #3). §4
justifies this; §11 records the alternative.

## 2. Product decisions (owner answers, this session)

| Decision | Choice |
| --- | --- |
| Staff identity across locations | **One linked identity** (org-level `person`) |
| What "swap" does | **Both** — single-shift cover **and** lend/move for a period |
| Location isolation | **Shared org-wide staff pool** (manage staff once at org level) |

The shared-pool experience is delivered *as an experience layer* over
per-location staff rows (§4), not by physically moving staff off the location.
This gives the owner "manage once, appears everywhere" without the tenancy
rewrite.

## 3. Data model (additive migrations; names indicative)

New / changed tables. All new domain tables carry `org_id`; per-location tables
keep `business_id` exactly as today.

**`organisation` (NEW)** — the account boundary.
- `id`, `name`, `default_timezone` (seeds a new location's tz), `created_at`.

**`org_membership` (NEW)** — which owners can access which org, with a role.
- `id`, `org_id` (cascade), `user_id` → `user` (cascade),
  `role` enum `org_role` (v1: `owner` only; column exists for later
  manager/viewer roles), `created_at`.
- Replaces the single `user.businessId` pointer as the source of "what can this
  signed-in owner reach" (see §6 for the migration of that column).
- (Optional, deferred) `location_membership` for per-location manager scoping —
  NOT built in v1; every org member is org-wide owner.

**`business` (= location) — CHANGED, additive.**
- Add `org_id` uuid → `organisation` (cascade). NOT NULL after backfill.
- Everything else about `business` is unchanged. In the **UI** we call it a
  **"location"**; we do **not** rename the table (blast radius, migrations, FKs)
  — a doc/UI alias only.

**`person` (NEW)** — the shared, org-wide staff identity (the "pool").
- `id`, `org_id` (cascade), `name`, `email`, `active`,
  `pay_rate_cents` / `rate_type` / `rate_label` (org-default pay — see §8),
  `pin_hash` + `failed_pin_attempts` + `pin_locked_until` (org-default PIN — see
  §8), `notify_by_default`, `created_at`.
- Unique on `(org_id, lower(email))` — one person per email per org.

**`staff_member` (= a person's presence AT one location) — CHANGED, additive.**
- Add `person_id` uuid → `person` (nullable at first for backfill, then set on
  every row; `on delete cascade` from person is wrong — use **`set null`** so a
  location keeps its history if a person is removed org-wide; the row is just
  unlinked/deactivated).
- **Keep the row per-location, keep every existing column and FK.** This is the
  linchpin: all of fact #1.3's downstream tables keep pointing at
  `staff_member.id`, so **zero existing domain queries change**.
- Pay/PIN on the row become **per-location values that default from the
  person** and MAY override (§8). Sync direction is a §11 decision.

**`shift_offer` — CHANGED, additive (Phase 3).**
- Add `scope` enum `offer_scope` (`location` | `org`, default `location`) — an
  `org`-scoped open shift is claimable by eligible people at *other* locations
  in the same org.
- Add `claimed_from_business_id` (nullable) — records the claimer's *home*
  location for an org-scoped claim (audit + notifications). The offer's own
  `business_id` stays the shift's location (where the work is).
- The existing partial-unique "one active offer per shift" is unchanged.

**`staff_loan` (NEW, Phase 4)** — an owner lending a person to another location
for a date range (record + driver of assignments).
- `id`, `org_id`, `person_id`, `from_business_id`, `to_business_id`,
  `start_date`, `end_date` (inclusive calendar dates), `note`, `created_at`.
- Informational + a hook the roster builder reads to show "on loan from
  <location>"; the actual coverage is still concrete `roster_assignment` rows at
  the target location (§7 Phase 4).

**Not changed:** `roster_assignment`, `timesheet_entry`, `shift`,
`shift_template`, `availability_*`, `leave_request`, `certification`, inventory,
forms, Xero tables, notifications — all stay `business_id`-scoped and untouched.

## 4. Architecture strategy — why "link, don't collapse"

Two ways to deliver a "shared org-wide staff pool":

- **Strategy A — collapse staff to the org.** Make `person` (org-level) the
  primary staff entity and add `staff_location_membership`; repoint
  `roster_assignment`, `timesheet_entry`, `leave_request`, `shift_offer`,
  `certification`, `staff_document`, `staff_notification`, `xero_employee_map`,
  `availability_*` off `staff_member` and onto `person` (+ location). This is
  the "true" shared pool — but it rewrites **every** person-referencing FK and
  query in the app, and every tenancy filter that currently reads
  `staff_member.business_id`. Highest correctness risk; a single missed filter
  is a **cross-tenant data leak**.

- **Strategy B — org `person` links per-location `staff_member` rows
  (RECOMMENDED).** Staff rows stay exactly where they are; a nullable
  `person_id` says "these two rows are the same human." The org "People" page is
  the single management surface; "add a person to a location" creates/links a
  `staff_member` there (pay/PIN defaulted from the person). Cross-location
  swap/lend = "ensure this person has an active `staff_member` at the target
  location, then assign normally."

**Recommendation: Strategy B.** It delivers all four owner outcomes (linked
identity, manage-once pool, single-shift cover, lend/move) while keeping the
per-location tenant boundary — and therefore every existing security invariant
and query — **untouched**. The blast radius becomes the *auth/session/org layer
+ new org pages*, not the ~37 owner pages and hundreds of tenant-scoped queries.
Correctly, work done at a location is recorded, paid, and Xero-pushed **at that
location** — which is what payroll/awards actually need. Strategy A can be
revisited later if a genuine single-row-per-person need appears; nothing here
forecloses it.

The rest of this plan assumes Strategy B.

## 5. Tenancy & security — the new invariants

The existing rule ("`business_id` always from the session / a validated token,
never client input") is preserved verbatim. New rules layered on top:

- **N1 — Org is derived, never trusted.** The signed-in owner's `org_id` comes
  from `org_membership` (server-side), never from request input. New guard
  `requireOrg()` (org-level pages) beside `requireOwner()`.
- **N2 — Active location must belong to the owner's org.** The location
  switcher (§6) sets an *active* `business_id`; on every owner request we verify
  `business.org_id === session.orgId` before building `createTenantRepo`. A
  forged/stale location id → reject (redirect to a safe default), exactly like
  today's onboarding guard. Reuse the `resolveOwnedSupplierId` pattern: a
  foreign id is coerced/refused, never honoured.
- **N3 — Cross-location writes validate BOTH sides share the org, in one
  transaction.** The org-level transfer core (`approveOrgOffer`, `lendPerson`)
  re-reads `from_business.org_id` and `to_business.org_id` inside the tx and
  aborts unless both equal the acting owner's `org_id`. This is the ONE place
  the single-business assumption is deliberately crossed, so it is the most
  heavily tested (§11 testing).
- **N4 — Staff surfaces stay per-location.** `/clock`, `/kiosk`, `/me` still
  resolve their business from a **per-location capability token**. A person with
  presences at two locations has a `staff_member` (and token/PIN) at each. There
  is **no** org-wide staff login; the "shared identity" is an owner-side concept,
  never a staff-side session that spans tenants.
- **N5 — `createTenantRepo(businessId)` is unchanged and still the only path to
  domain rows.** Org-level reads/writes go through a **new** `createOrgRepo(orgId)`
  that only ever touches org-scoped tables (`organisation`, `org_membership`,
  `person`, `staff_loan`) and, for cross-location orchestration, composes two
  `createTenantRepo` instances after the N3 check. Org repo never bypasses
  per-location scoping.

## 6. Session, auth & the location switcher

- **Session shape.** Add `session.user.orgId` and keep an **active**
  `session.user.businessId` (the currently-selected location). Auth callback
  (`src/lib/auth/index.ts`) derives `orgId` from `org_membership`; the active
  location is the last-used (persisted per user) or the org's first location.
- **`user.businessId` migration.** Keep the column during transition for
  compatibility, but stop treating it as the tenant source. Phase 0 backfills
  `org_membership` from it; `requireOwner()` starts reading org + active
  location. Column retired in a later cleanup once nothing reads it.
- **Switcher UI.** A location dropdown in the owner header
  (`src/components/OwnerNav.tsx` / `src/app/app/layout.tsx`), listing the org's
  locations, "＋ Add location", and (for org pages) a "People" / "Locations"
  entry. Switching sets the active location (validated per N2) and re-renders
  owner pages against the new tenant. Purely additive to the existing nav.
- **Onboarding.** First sign-in now creates `organisation` → first `business`
  (location) → `org_membership(owner)` in one transaction, then sets the active
  location. `src/app/onboarding/page.tsx` updated; SSO provisioning
  (`src/lib/sso/*`, `sso-session.ts`) updated to create/attach an org the same
  way. Account-clarity copy (`AccountIdentity`) updated to show org + active
  location.

## 7. Phasing (each phase independently shippable & green)

**Phase 0 — Foundations, invisible (no behaviour change).**
Add `organisation`, `org_membership`, `business.org_id`, `person`,
`staff_member.person_id` (all additive). Backfill: one org per existing
business, one membership per existing `user.businessId`, and one `person` per
existing `staff_member` (link 1:1). After this, every owner still has exactly
one org + one location and sees no difference. **This is the highest-risk step**
(a data migration over live tenant data) and ships alone, behind no UI.
Idempotent, reversible, dual-read safe (§10).

**Phase 1 — Multiple locations.**
Org-scoped guards (`requireOrg`, N2 active-location check), `createOrgRepo`,
the header **location switcher**, "Add location" flow, per-location Settings
still independent. Onboarding/SSO create an org. Delivers *"add multiple
locations in their access."* Staff still fully per-location (no pool yet).

**Phase 2 — Shared people / linked identity (the pool).**
Org **People** page (`/app/people` or an org-level route): list people, add a
person, see which locations they're at. "Add person to location" creates/links a
`staff_member` (pay/PIN defaulted from the person — §8). A one-time **link
helper** to merge existing same-email `staff_member` rows across the owner's
locations into one `person`. Delivers the *manage-once shared pool*.

**Phase 3 — Cross-location single-shift cover (extend swaps).**
`shift_offer.scope`; an owner (or, if enabled, staff) can post an open shift as
**org-scoped**; eligible claimers include people at other org locations. Claim
→ owner approve → `approveOrgOffer`: N3 check, **ensure the claimer's person has
an active `staff_member` at the shift's location** (create-or-reuse a linked
profile), then the existing atomic transfer. Notifications extended. Delivers
*single-shift cross-location swap*.

**Phase 4 — Lending / owner-initiated move.**
`staff_loan` + an owner action: pick a person, a target location, a date range →
ensure membership/`staff_member` at target, create confirmed `roster_assignment`
rows for matching shifts (or make the person assignable in that location's
roster builder for the range). Roster builder shows "on loan from <location>".
Delivers *lend/move for a period*.

**Phase 5 — Cross-location polish.**
Org-level read-only reporting (aggregate hours/labour-cost across locations —
extends `labour-report.ts` with an org rollup), a **person double-booking flag**
(soft, across the person's locations — §8), org-aware notification bell
(decision §11), Xero-per-location review, docs + CLAUDE.md update (§12).

## 8. Cross-cutting concerns

- **PIN.** Recommend: the **person** holds the canonical PIN; linking/creating a
  `staff_member` mirrors `pin_hash` to that location so the employee uses **one
  PIN everywhere**. Per-location override allowed but discouraged. (Alternative:
  independent per-location PINs — simpler code, worse UX. §11.)
- **Pay rate.** Org default on `person`; per-location `staff_member` override
  allowed (some venues/awards differ). Timesheets, CSV export, labour report and
  Xero all read the **per-location** `staff_member` rate as they do today — so
  no export/report code changes, and a borrowed shift is costed at the location
  where it was worked.
- **Double-booking.** A person can't be in two places at once. Add a **soft
  flag** (never a hard block, matching the existing leave/overlap philosophy)
  computed across the person's linked `staff_member` rows when assigning /
  claiming / lending. Owner sees "already rostered at <other location> that
  time" and decides.
- **Availability & rosters.** Unchanged per-location. A borrowed person appears
  in the target location's roster/availability only once they have an active
  `staff_member` there (Phase 2/4 create it).
- **Notifications & emails.** Existing per-location leave/swap/roster emails and
  `/me` notices are unchanged. Cross-location cover adds notices to the target
  owner + the claiming person (via their target-location `staff_member`). The
  owner bell: v1 keep it per-active-location; an org-wide aggregated bell is a
  §11 decision for Phase 5.
- **Xero.** Stays per-location (each location has its own `xero_connection` and
  employee map). A person mapped at two locations = two Xero employee maps
  (correct — they may be different Xero employees/orgs). No boundary change.
- **Timezones.** Each location keeps its own `business.timezone`. All the
  existing business-local date/time logic is unaffected because it's still
  computed per `business`.

## 9. Migration & backfill safety (Phase 0 detail)

- Additive columns nullable first; backfill in the same migration; add NOT NULL
  / unique constraints only after backfill succeeds.
- Backfill is **idempotent** (re-runnable): "create org if none for this
  business", "create membership if none", "create+link person if
  `staff_member.person_id` is null". Guarded by `WHERE ... IS NULL` /
  `ON CONFLICT DO NOTHING`.
- **Dual-read window:** `requireOwner()` prefers org membership but falls back
  to `user.businessId` until Phase 1 cuts over, so a half-migrated deploy is
  safe.
- No destructive changes; `user.businessId` retired only in a later,
  separate cleanup migration once code no longer reads it.
- Follow the repo convention: `npm run db:generate` from the schema diff, review
  the SQL, apply against the CI Postgres service, keep CI green.

## 10. Open decisions to confirm before/with the build

1. **Org route shape** — org pages under `/app` with a switcher (recommended,
   least disruptive) vs. a separate `/org` area. Recommend the former.
2. **PIN model** — person-canonical mirrored to locations (recommended) vs.
   independent per-location PINs.
3. **Pay override** — allow per-location rate override (recommended) vs. strictly
   one org rate.
4. **Who can post an org-scoped open shift** — owner only (recommended for v1)
   vs. also staff from the `/clock`·`/kiosk` "My shifts" view.
5. **Owner bell scope** — per-active-location (recommended v1) vs. org-aggregated.
6. **Multi-owner** — v1 single `owner` role only (recommended); membership table
   is built to allow more later.
7. **Strategy A vs B** — plan assumes **B** (link, don't collapse). Confirm.

## 11. Testing (mirrors the repo's pure-logic + flow split)

- **Pure/unit:** org membership resolution; active-location validation (N2);
  the N3 both-sides-share-org check; person↔staff link/create-or-reuse;
  double-booking flag; org labour rollup.
- **Flow (against Postgres):** Phase 0 backfill idempotency + tenant isolation;
  cross-location `approveOrgOffer` (claimer gets a linked `staff_member` at the
  shift's location, transfer is atomic, releaser removed); lending creates
  correct assignments; **negative tests that a location in org X can never read
  or borrow from org Y** (the crown-jewel N1–N3 tests) and that a forged active
  location id is rejected.
- Keep every existing test green — Strategy B means they should not need changes.

## 12. Docs to update on build

- **CLAUDE.md** — this is a scope change, so it must move in lock-step: update
  "Product scope" (one-business assumption → org-of-locations), "Non-negotiable
  conventions → Multi-tenancy" (add the org invariants N1–N5), the shift-swap
  decision (now allows owner-approved *cross-location* cover), and the data
  model section (new tables/columns). Add an M29 milestone.
- **README** — env/setup notes if any; the location switcher in the owner tour.
- This file — flip **Status** to BUILT with the decisions as-shipped, per repo
  convention.
