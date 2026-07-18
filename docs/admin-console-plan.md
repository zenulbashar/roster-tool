# Zale IT admin console + impersonation (M37)

The vendor ("Zale IT") back-office: a platform-operations surface, separate from
any tenant, for supporting Roster's client venues. Design source of truth:
`design/roster-handoff/05-admin/admin-spec.md` +
`foundation/design-tokens.md §6` (indigo palette).

## What it is

- **Cross-tenant read** over every client account (clients list + KPIs, one
  client's detail, an append-only admin activity log).
- **Impersonation** ("view as venue"): an admin enters a live tenant to support
  them, wrapped in an ever-present red safety framing (banner + inset frame +
  a write-confirm gate) and a full audit trail.

A "client" is an **`organisation`** (the account boundary since M29); each client
has one or more **locations** (`business` rows) and an org-wide staff pool.

## Non-negotiable boundaries

1. **The admin console is the SINGLE, EXPLICIT exception** to the codebase's
   per-business tenant scoping. All cross-tenant reads live in ONE place —
   `src/lib/admin/repository.ts` (`createAdminRepo`) — reachable only behind
   `requireAdmin()`. No other module reads across tenants. The admin repo never
   exposes a tenant's operational rows (rosters, timesheets, pay); only counts,
   integration presence, last-active signals, and the admin audit log.
2. **Admins are Zale IT staff, not owners.** Admin access is a `platform_admin`
   row, NOT an `org_membership`. An admin still signs in with the ordinary email
   magic link (a ROLE grant on top of the existing login — never a separate login
   method). An admin has no org and reaches a tenant only through impersonation.
3. **Impersonation is signed, short-lived, and re-validated every request.** The
   grant rides in an httpOnly, AUTH_SECRET-signed cookie
   (`src/lib/admin/impersonation.ts`, 2 h TTL) bound to (admin, org, entry
   location). `resolveImpersonation` re-checks the HMAC + freshness, that the
   acting user is STILL a `platform_admin` (revoking admin instantly ends it),
   and that the bound location still belongs to the bound org. Nothing is stored
   server-side; it can't be refreshed without going back through the console.
4. **Everything an admin changes while impersonating writes to the tenant's REAL
   data** — the console adds no write path of its own beyond `plan_status`. The
   safety is procedural (framing + confirm + audit), and it is built faithfully.

## Architecture

### Auth (`src/lib/admin/context.ts`)

- `resolveAdmin()` — session → `platform_admin` row → `AdminIdentity`, or null.
  Bootstrap: an email in `ADMIN_ALLOWLIST` is provisioned a row on first sign-in
  (idempotent). **FAIL CLOSED** — an unset/empty allow-list provisions nobody.
- `requireAdmin()` — signed-out → sign-in; signed-in non-admin → **404** (the
  area doesn't exist for them). Gates the whole `/admin` subtree.
- `isPlatformAdmin` / `getAdminDisplayName` live in `repository.ts` (no Auth.js
  import) so `requireOwner` + the impersonation session can use them without
  pulling NextAuth into non-request contexts.

### Cross-tenant reads (`src/lib/admin/repository.ts`)

`createAdminRepo()`: `listClients({status,search})`, `getClientStats()` (KPIs),
`getClient(orgId)` (detail + per-location integrations + recent activity),
`firstLocationOfOrg`, `listActivity`/`countActivity`, `recordActivity`.
Aggregates are bounded grouped queries keyed by org; last-active = latest
clock-in or roster-period-created across the org's locations.

### Impersonation session (`src/lib/admin/impersonation-session.ts`)

`resolveImpersonation()` (read + full re-validate), `setImpersonationCookie`,
`clearImpersonationCookie`.

### `requireOwner` integration (`src/lib/auth/context.ts`)

Before the normal path, `requireOwner` checks `resolveImpersonation()`. When
impersonating it resolves the org from the grant (NOT an org_membership) and the
active location via the usual `resolveActiveLocation` — so the in-app **location
switcher still works** while impersonating — and returns an `impersonation`
marker the owner layout uses to render the framing. Cheap for ordinary owners:
an absent cookie returns before any query. A non-impersonating platform admin who
hits `/app` is redirected to `/admin/clients` (they have no org).

### UI

- **Chrome** — `src/app/admin/layout.tsx`: dedicated **indigo** top bar
  (`#1E1B4B`), `shield_person` mark + ROSTER (`#A5B4FC`) + ADMIN badge, Clients /
  Activity log tabs (`src/components/admin/AdminNav.tsx`), admin identity.
- **Pages** — `/admin/clients` (KPIs + search + status filters + table),
  `/admin/clients/[id]` (detail: plan/billing + status setter + per-location
  integrations + recent activity), `/admin/log` (paginated audit table).
- **Entry** — `src/components/admin/ImpersonationEntryModal.tsx` (red-headed
  confirm, full read/write warning) → `enterImpersonation` action.
- **Framing (owner layout)** — `ImpersonationBanner` (fixed 52px red striped bar
  - "Exit to admin"), a fixed 4px `#DC2626` inset frame, and content pushed down
    52px.
- **Write-confirm** — `ImpersonationWriteGuard`: a single capturing `submit`
  listener on the `<main>` content region intercepts POST (server-action) form
  writes and shows the "Save to live account" modal; on confirm it best-effort
  logs the write, then re-submits. Chrome forms (nav, sign-out, exit, location
  switcher, bell) live OUTSIDE `<main>`, so they're never intercepted — no
  per-form annotation needed. GET forms (search/filter) pass through.

### Actions (`src/app/admin/actions.ts`)

`enterImpersonation` (set cookie + log "Entered live account" + → `/app`),
`exitImpersonation` (log "Exited" + clear + → `/admin/clients`),
`logImpersonatedWrite` (best-effort audit, never redirects/blocks the write),
`setPlanStatus` (the one admin write to tenant-adjacent data — a vendor label).

## Data model (additive migration `0032`)

- `platform_admin` — `user_id` (unique, cascade) + optional display `name`.
- `admin_activity` — append-only audit: `admin_name`/`action`/`detail`/
  `is_write` + snapshotted `org_id`/`business_id`/`venue_name` (FKs SET NULL so a
  row survives deletion). Indexed on `created_at` + `org_id`.
- `organisation.plan_status` (`plan_status` enum `active`/`trial`/`paused`,
  default `active`) — a vendor account-lifecycle label. **NOT billing/wage data**
  — it drives the admin filters + KPIs only and never changes tenant behaviour.

## Deliberately scoped / known limits

- **Billing is NOT tracked in-app** (out of scope). The client detail shows the
  flat-fee plan + "customer since" (real) with a clear note that payments are
  handled outside Roster. `plan_status` is a lifecycle label, not a payment state.
- **The write-confirm modal covers form-submitted writes** (essentially all owner
  writes). A few JS-driven actions (e.g. the drag-and-drop roster board) call
  server actions programmatically and aren't gated by the modal; the always-on
  banner + inset frame + the logged enter/exit session bracket every action
  regardless.
- **NOT built (future):** multi-admin roles beyond a single platform admin,
  a real billing/subscription system, cross-org tooling.
