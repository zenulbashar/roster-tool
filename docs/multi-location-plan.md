# Multi-location & cross-location staffing — plan of record

**Status: IN BUILD (M29)** — research done, plan reviewed, **owner authorized
the build (Strategy A — collapse; see §4)**. This is a deliberate,
owner-requested **expansion of the MVP boundary**: CLAUDE.md today defines the
product as _one owner = one business = one tenant_, and lists **cross-tenant**
and **bilateral swaps** as out of scope. This feature knowingly crosses that
line. The build updates CLAUDE.md's "Product scope" + "Non-negotiable
conventions" sections in lock-step (see §12).

**Decision log:**

- Staff identity across locations → **one linked identity**.
- What "swap" does → **both** single-shift cover **and** lend/move for a period.
- Location isolation → **shared org-wide staff pool**.
- Build strategy → **Strategy A (collapse staff to the org)** — the owner chose
  the fuller rewrite over the lighter-touch Strategy B, accepting the larger
  blast radius for a single-record-per-person model. §4 records what that means
  and how the phasing keeps each step green and reversible.

## 0. What this is (and is not)

Let one **owner account** manage **several locations** (cafés/venues) and move
staff between them.

The owner asked for, and this plan targets (confirmed via clarifying questions):

1. **Add multiple locations** under a single owner's access.
2. **One linked staff identity** across locations (an employee who works at two
   venues is _one_ person, not two unrelated profiles).
3. A **shared, org-wide staff pool** — staff (and their pay) are managed once at
   the org level, not re-typed per location.
4. **Both** kinds of "swap": (a) single-shift **cross-location cover** (extend
   the existing release → claim → owner-approve flow across locations), and (b)
   owner-initiated **lending / move** of a person to another location for a date
   range.

**This is NOT** (kept out, consistent with the app's philosophy):

- **NOT** a dilution of per-location isolation for _work records_. **Staff
  collapse to the org** (Strategy A), but everything a location _does_ — shift
  templates, roster periods, shifts, roster assignments, timesheets, inventory,
  forms, settings, kiosk/personal-clock tokens, Xero connection — **stays
  scoped to its own `business` (location)**. The org layer owns _who the people
  are_; each location still owns _what happened there_. Location scoping of work
  records is preserved by those tables' own `business_id`; only the **staff
  roster** (the list of people) becomes org-level, reached per location through
  a `staff_location` membership. (See §4 — the single most important choice.)
- **NOT** bilateral A↔B auto-swaps. Every cross-location handover is still
  **owner-approved**, one-directional (release/claim or owner-assign). No
  auto-approval.
- **NOT** cross-_org_ anything. Sharing is only ever **within one owner's org**.
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
   (`src/lib/tenant/repository.ts:82`) _injects and filters_ `business_id` on
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
   `shift` are _the same business_. The releaser/claimer are same-business staff
   (`src/lib/shift-offer-submission.ts`). Staff surfaces (`/clock`, `/kiosk`)
   resolve the business from a **per-business capability token**, never client
   input (`src/lib/tenant/kiosk-access.ts`, `personal-clock-access.ts`).
5. **No `organisation` or `location` concept exists yet.** Confirmed: no such
   table, no grouping above `business`.

**Design consequence:** the owner chose to **collapse staff to the org**
(Strategy A). The key mitigation that keeps this tractable: `staff_member.id`
stays the PK every downstream table references (fact #3), so the collapse moves
the staff row's _tenant_ (business → org) and rewrites staff _scoping filters_,
but does NOT repoint the person graph. Each location keeps its own `business`
tenant for all _work records_. §4 details what A touches; §7 phases it so each
step stays green.

## 2. Product decisions (owner answers, this session)

| Decision                        | Choice                                                          |
| ------------------------------- | --------------------------------------------------------------- |
| Staff identity across locations | **One linked identity** (org-level `staff_member`)              |
| What "swap" does                | **Both** — single-shift cover **and** lend/move for a period    |
| Location isolation              | **Shared org-wide staff pool** (manage staff once at org level) |

Under the chosen Strategy A (§4), the shared pool is delivered by moving the
staff record itself to the org: one `staff_member` per person, org-scoped,
reaching each location through a `staff_location` membership. "Manage once,
appears everywhere" is then a property of the data model, not just the UI.

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

**`staff_member` (= the org-level person) — CHANGED (Strategy A collapse).**

- Add `org_id` uuid → `organisation`. This becomes the staff row's tenant.
- **The `staff_member.id` PK does not change**, so every downstream table in
  fact #1.3 that references it (`roster_assignment`, `timesheet_entry`,
  `availability_*`, `leave_request`, `shift_offer`, `staff_certification`,
  `stock_check_entry`, `staff_notification`, `staff_document`,
  `xero_employee_map`) keeps working — no FK repointing. The rewrite is in the
  **scoping filters** (queries that today read `staff_member.business_id`), not
  the relationships.
- `business_id` is **kept as the "home location"** through the transition (it is
  NOT NULL today and every staff query uses it). It is retired only in a late
  cleanup once all staff scoping goes through `org_id` + `staff_location`.
- Pay (`pay_rate_cents`/`rate_type`/`rate_label`) and PIN (`pin_hash` +
  lockout) live on the org-level row — **one pay rate + one PIN per person,
  org-wide** — with an optional per-location override deferred to §8/§11.
- New unique target `(org_id, lower(email))` (added after backfill dedupes) —
  one person per email per org, replacing the per-business email unique.

**`staff_location` (NEW)** — which locations a person can work at (membership).

- `id`, `org_id` (cascade), `business_id` → `business` (cascade),
  `staff_member_id` → `staff_member` (cascade), `active`, `created_at`.
- Unique on `(business_id, staff_member_id)` — one membership per person per
  location. This is what makes a person appear in a location's roster /
  availability. A location lists its staff via this join; assigning a borrowed
  person means first ensuring an (active) membership at the target location.
- Backfilled 1:1 from each existing `staff_member`'s current `business_id`.

**`shift_offer` — CHANGED, additive (Phase 3).**

- Add `scope` enum `offer_scope` (`location` | `org`, default `location`) — an
  `org`-scoped open shift is claimable by eligible people at _other_ locations
  in the same org.
- Add `claimed_from_business_id` (nullable) — records the claimer's _home_
  location for an org-scoped claim (audit + notifications). The offer's own
  `business_id` stays the shift's location (where the work is).
- The existing partial-unique "one active offer per shift" is unchanged.

**`staff_loan` (NEW, Phase 4)** — an owner lending a person to another location
for a date range (record + driver of assignments).

- `id`, `org_id`, `staff_member_id`, `from_business_id`, `to_business_id`,
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

**Decision: Strategy A (collapse), chosen by the owner.** The plan originally
recommended B; the owner chose A for a true single-record-per-person model,
accepting the larger blast radius. This section records what A entails and how
the phasing contains its risk.

**What A actually touches (and what it doesn't):**

- **Does NOT repoint person FKs.** `staff_member.id` stays the PK every
  downstream table references, so `roster_assignment`, `timesheet_entry`,
  `leave_request`, `shift_offer`, `certification`, `staff_document`,
  `staff_notification`, `xero_employee_map`, `availability_*` keep their
  relationships. The "collapse" moves the staff row's _tenant_ from a business
  to an org; it does not rewire the graph.
- **Does NOT move work records to the org.** Every work-record table keeps its
  own `business_id`; a roster/timesheet/leave/stock row still belongs to the
  location where it happened. Only the **staff list** goes org-level, surfaced
  per location via `staff_location`.
- **DOES rewrite staff _scoping filters_.** Every query that reads
  `staff_member.business_id` (staff lists, availability recipient pickers, the
  clock/kiosk staff lookups, the Staff page) must become org- or
  membership-aware. This is the real work and the real risk — a missed or wrong
  filter is a **cross-tenant staff leak**, so these are migrated deliberately,
  one surface at a time, each behind tests (§11).

**How the phasing contains the risk:** `staff_member.business_id` is **kept as a
"home location" throughout the transition**. Phase 0 adds `org_id` +
`staff_location` and backfills them while every query still uses `business_id`
(invisible, no behaviour change). Later phases move one staff-scoping surface at
a time onto `org_id`/membership, each independently shippable and green, with
`business_id` retired only in a final cleanup once nothing reads it. So at no
point is the tree broken or a boundary half-live.

The rest of this plan assumes Strategy A.

## 5. Tenancy & security — the new invariants

The existing rule ("`business_id` always from the session / a validated token,
never client input") is preserved verbatim. New rules layered on top:

- **N1 — Org is derived, never trusted.** The signed-in owner's `org_id` comes
  from `org_membership` (server-side), never from request input. New guard
  `requireOrg()` (org-level pages) beside `requireOwner()`.
- **N2 — Active location must belong to the owner's org.** The location
  switcher (§6) sets an _active_ `business_id`; on every owner request we verify
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
  resolve their location from a **per-location capability token**
  (`business.kiosk_token_hash` etc.), never client input. A kiosk only ever
  lists and acts on staff who are **members of that location** (`staff_location`
  filter) — the org collapse must NOT make one location's kiosk show the whole
  org's people. The staff PIN is the one org-wide PIN, but a person can only use
  it at a location they're a member of. There is **no** org-wide staff login;
  the "shared identity" is an owner-side concept, never a staff session spanning
  tenants.
- **N5 — `createTenantRepo(businessId)` is unchanged and still the only path to
  domain rows.** Org-level reads/writes go through a **new** `createOrgRepo(orgId)`
  that only ever touches org-scoped tables (`organisation`, `org_membership`,
  `staff_member`, `staff_location`, `staff_loan`) and, for cross-location
  orchestration, composes two `createTenantRepo` instances after the N3 check.
  Org repo never bypasses per-location scoping.

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
Add `organisation`, `org_membership` (+ `org_role` enum), `staff_location`
(all new); add `business.org_id` and `staff_member.org_id` (nullable). Backfill,
idempotently: one org per existing business (reusing the business id as the org
id for a trivially linkable 1:1), one `org_membership` per existing
`user.businessId`, `staff_member.org_id` = its home business's org, and one
`staff_location` per existing `staff_member` at its current `business_id`. After
this, every owner still has exactly one org + one location, staff scoping still
runs entirely off `business_id`, and nobody sees a difference. Ships alone,
behind no UI. Idempotent, reversible, dual-read safe (§9).

**Phase 1 — Multiple locations.**
Org-scoped guards (`requireOrg`, N2 active-location check), `createOrgRepo`,
the header **location switcher**, "Add location" flow, per-location Settings
still independent. Onboarding/SSO create an org. Delivers _"add multiple
locations in their access."_ Staff still fully per-location (no pool yet).

**Phase 2 — Collapse staff scoping to the org (the pool).**
Move every staff-listing / staff-scoping surface off `business_id` and onto
`org_id` + `staff_location` membership, one surface at a time (Staff page,
availability recipient picker, roster builder's assignable-staff list, the
clock/kiosk/notices staff lookups). Add an org **People** page (`/app/people`):
list people org-wide, add a person, toggle which locations they're a member of
(writes `staff_location`). A one-time **merge helper** dedupes existing
same-email staff rows across the owner's locations into a single org
`staff_member`, then the `(org_id, lower(email))` unique is enforced. Delivers
the _manage-once shared pool_.

**Phase 3 — Cross-location single-shift cover (extend swaps).**
`shift_offer.scope`; an owner (or, if enabled, staff) can post an open shift as
**org-scoped**; eligible claimers include people at other org locations. Claim
→ owner approve → `approveOrgOffer`: N3 check, **ensure the claimer's person has
an active `staff_member` at the shift's location** (create-or-reuse a linked
profile), then the existing atomic transfer. Notifications extended. Delivers
_single-shift cross-location swap_.

**Phase 4 — Lending / owner-initiated move.**
`staff_loan` + an owner action: pick a person, a target location, a date range →
ensure membership/`staff_member` at target, create confirmed `roster_assignment`
rows for matching shifts (or make the person assignable in that location's
roster builder for the range). Roster builder shows "on loan from <location>".
Delivers _lend/move for a period_.

**Phase 5 — Cross-location polish.**
Org-level read-only reporting (aggregate hours/labour-cost across locations —
extends `labour-report.ts` with an org rollup), a **person double-booking flag**
(soft, across the person's locations — §8), org-aware notification bell
(decision §11), Xero-per-location review, docs + CLAUDE.md update (§12).

## 8. Cross-cutting concerns

- **PIN.** Under Strategy A the staff row _is_ the org-level person, so `pin_hash`
  - lockout live there once: **one PIN, org-wide**, usable at any location the
    person is a member of. No mirroring. (A later per-location PIN override is
    possible but out of v1 — §10.) Lockout counters staying on the single row also
    means the brute-force guard is naturally org-wide.
- **Pay rate.** One rate on the org-level `staff_member` by default. A shift's
  cost is still computed and Xero-pushed **at the location where it was worked**
  (those reads join `roster_assignment`/`timesheet_entry` → `staff_member`, which
  still works). A per-location pay override (some venues/awards differ) is a §10
  decision; if taken, it moves the rate onto `staff_location`.
- **Double-booking.** A person can't be in two places at once. Add a **soft
  flag** (never a hard block, matching the existing leave/overlap philosophy)
  computed across the person's assignments at _all_ their locations when
  assigning / claiming / lending. Owner sees "already rostered at <other
  location> that time" and decides. Straightforward now that one person = one
  `staff_member.id`.
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
- Backfill is **idempotent** (re-runnable): "create org for a business if it has
  none" (org id = business id at migration time, `ON CONFLICT DO NOTHING`), "set
  `business.org_id`/`staff_member.org_id` `WHERE ... IS NULL`", "create
  membership / `staff_location` `ON CONFLICT DO NOTHING`".
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
2. **PIN model** — one org-wide PIN on the staff row (default under Strategy A)
   vs. a later per-location PIN override. v1: one org-wide PIN.
3. **Pay override** — one org rate (default under Strategy A) vs. a per-location
   override on `staff_location`. v1: one org rate; revisit if a venue needs it.
4. **Who can post an org-scoped open shift** — owner only (recommended for v1)
   vs. also staff from the `/clock`·`/kiosk` "My shifts" view.
5. **Owner bell scope** — per-active-location (recommended v1) vs. org-aggregated.
6. **Multi-owner** — v1 single `owner` role only (recommended); membership table
   is built to allow more later.
7. **Strategy A vs B** — **RESOLVED: Strategy A (collapse)**, owner's choice.

## 11. Testing (mirrors the repo's pure-logic + flow split)

- **Pure/unit:** org membership resolution; active-location validation (N2);
  the N3 both-sides-share-org check; membership (`staff_location`) resolution;
  double-booking flag; org labour rollup.
- **Flow (against Postgres):** Phase 0 backfill idempotency + tenant isolation;
  each staff-scoping surface after it moves to org+membership (a kiosk shows
  ONLY its location's members; the Staff page shows the org's people);
  cross-location `approveOrgOffer` (claimer gets an active `staff_location` at
  the shift's location, transfer is atomic, releaser removed); lending creates
  correct assignments; **negative tests that a location in org X can never read
  or borrow from org Y** (the crown-jewel N1–N3 tests) and that a forged active
  location id is rejected.
- Under Strategy A some existing tests WILL change as staff scoping moves off
  `business_id`; each such change ships in the phase that causes it, never as a
  silent edit.

## 12. Docs to update on build

- **CLAUDE.md** — this is a scope change, so it must move in lock-step: update
  "Product scope" (one-business assumption → org-of-locations), "Non-negotiable
  conventions → Multi-tenancy" (add the org invariants N1–N5), the shift-swap
  decision (now allows owner-approved _cross-location_ cover), and the data
  model section (new tables/columns). Add an M29 milestone.
- **README** — env/setup notes if any; the location switcher in the owner tour.
- This file — flip **Status** to BUILT with the decisions as-shipped, per repo
  convention.
