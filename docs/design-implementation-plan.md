# Design implementation plan — "Roster" high-fidelity redesign

This document tracks the effort to make the app match the **design handoff**
shipped in `design/` (original zip: `design/Roster__Hospitality_Workforce_SaaS.zip`;
browsable copy: `design/handoff/`). Keep it current as screens land.

## Source of truth

- **`design/handoff/README.md`** — design tokens (colour, type, spacing, radii,
  shadows, motion), per-screen specs, interaction notes.
- **`design/handoff/design/Roster.dc.html`** — the exact markup, copy and every
  toast string for every screen. This is a reference prototype built on an
  in-house runtime (`support.js`); **we do not port that runtime** — we recreate
  the look in our own Next.js + Tailwind stack.
- **`design/handoff/screenshots/<NN-screen>/`** — per-screen and per-block
  captures. `01-shot` = in-app (dark nav) narrow; `02-shot` = full 1300px layout
  reference; `03+` = isolated blocks.

## Design tokens (already in `src/app/globals.css`)

- Primary green `#76b900` (hover `#6aa600`); green tint surface `#F4F8E9`.
- Ink `#111827`; dark nav bg `#111827`; text `#374151`/muted `#6B7280`/faint `#9CA3AF`.
- Border `#E5E7EB`; app bg `#F9FAFB`; surface `#FFFFFF`; table header `#FAFBFC`.
- Semantic: success `#15803D`/`#ECFDF3`, warn `#B45309`/`#FEF3E2`,
  danger `#B91C1C`/`#FEECEC`, info `#1D4ED8`/`#EFF6FF`, draft `#6B7280`/`#F3F4F6`.
- Shift palette: Morning green, Arvo `#7C5CBF`, Close `#1E293B`, Split `#D97706`.
- Type: **Archivo** (display/headings/numbers/badges) + **Public Sans** (body/UI)
  + **Material Symbols Rounded** (icons). Content max-width **1340px**, page
  padding `26px 30px 80px`. Cards radius 14, big cards 16, shadow
  `0 1px 2px rgba(17,24,39,.04)`.
- Brand wordmark is **ROSTER** (green) + `grid_view` glyph tile; "Zaleit IT" is
  only the company name (footer/meta).

## Global chrome

- **Owner top nav** (dark `#111827`, 60px): ROSTER brand · tenant name · groups
  **Rosters / Team / Orders / Settings** (hover+click dropdowns, active group
  underlined `inset 0 -2px 0 #76b900` + green text) · notification **bell**
  (unread count + red pulse) · **Sign out**. We additionally keep a **Forms**
  nav item (feature exists in the app but not in the design — retained, not
  removed). The prototype's left "rail" is a demo device and is **not** built.

## Screen status

| # | Screen | Route | Status | Notes |
|---|--------|-------|--------|-------|
| 1 | Marketing landing | `/` | ✅ redesigned | dark hero, mini roster mockup, feature row, 3-step, pricing, footer |
| 2 | Sign in | `/sign-in` (+ `/sign-in/check-email`) | ✅ redesigned | centered card on radial green wash, passwordless |
| 3 | Onboarding | `/onboarding` | ✅ redesigned | identity strip + business-name card |
| 4 | Dashboard | `/app` | ✅ redesigned | KPI tiles, quick actions, recent activity; getting-started card retained |
| 5 | Roster periods | `/app/periods` | ✅ redesigned | list card with period rows |
| 6 | Roster builder ★ | `/app/periods/[id]/build` | ✅ redesigned | colour-coded sticky grid + legend |
| 7 | Shift types | `/app/templates` | ✅ redesigned | 3-col card grid + new-type card |
| 8 | Timesheets | `/app/timesheets` | ✅ redesigned | table, status badges, inline approve |
| 9 | Reports | `/app/reports` | ✅ redesigned | KPI tiles + weekly bars + staff cost table |
| 10 | Staff | `/app/staff` | ✅ redesigned | two-pane list + detail (rate, notices, certs, docs) |
| 11 | Leave | `/app/leave` | ✅ redesigned | info banner + request rows |
| 12 | Certifications | `/app/certifications` | ✅ redesigned | filter toggle + table with badges |
| 13 | Stock levels | `/app/stock` | ✅ redesigned | table, needs-order highlighting |
| 14 | Items | `/app/items` (+ import) | ✅ redesigned | table; CSV preview card |
| 15 | Suppliers | `/app/suppliers` | ✅ redesigned | 2-col card grid + delivery-day chips |
| 16 | Settings | `/app/settings` | ✅ redesigned | two-column cards (account/clock-in/notifications/drive) |
| 17 | Kiosk clock-in | `/kiosk` | ✅ redesigned | dark full-screen state machine |
| — | Notifications | `/app/notifications` + bell | ✅ redesigned | bell dropdown + full list |
| P1 | Phone clock-in | `/clock` | ✅ redesigned | dark, large-touch, brand tokens |
| P2 | Staff notices | `/me` | ✅ redesigned | light, brand tokens |
| P3 | Public roster | `/r/[slug]` | ✅ redesigned | light, brand tokens |
| P4 | Availability | `/a/[token]` | ✅ redesigned | light, brand tokens |

## "Coming soon" / gaps (design shows it, data model doesn't back it yet)

These are surfaced in the UI as clearly-labelled placeholders and are **planned
follow-ups**, not silent omissions:

- **Items → Category column & chips** (Meat/Produce/Packaging/Beverages/Bakery):
  the `item` table has no `category` field. Shown as a muted placeholder; a
  future migration can add `item.category` + the chip palette.
- **Items → Reorder threshold column**: intentionally out of MVP scope (CLAUDE.md
  lists reorder/par levels as post-MVP). Column shown as "—"/placeholder.
- **Suppliers → Category chip**: `supplier` has no category. Placeholder chip; a
  future migration can add `supplier.category`.
- **Dashboard KPI "Est. labour cost / On leave today / Certs expiring"**: wired to
  real data where available; any metric without a cheap read is shown with a
  best-effort value or a muted placeholder.
- **Roster builder drag-and-drop assign**: the design implies click-to-assign
  empty/open cells. Existing assignment flow is preserved; richer inline
  assign-on-click is a follow-up.

## Working method

- Presentation-only: never change server actions, data fetching, form field
  names, hrefs, tenancy scoping or validation. Reuse shared primitives in
  `src/components/ui.tsx` and the avatar helper in `src/lib/avatar.ts`.
- Keep it accessible: semantic HTML, keyboard nav, visible focus, WCAG AA.
- Preserve all product/compliance disclaimers (labour cost is an estimate, leave
  is record-only, pay rate informational, documents live in the owner's Drive).
