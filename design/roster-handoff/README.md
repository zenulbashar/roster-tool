# Roster — Developer Handoff Bundle

Everything needed to **rebuild the Roster designs in the real app** (Next.js + React +
the existing component kit + Drizzle) **without ever running the prototype**.

**Roster** (by Zale IT, `roster.zaleit.com.au`) is a flat-monthly-fee workforce app for
small Australian hospitality venues — rosters, clock-ins, leave, certs, stock and supplier
orders, plus a Xero hours-push and a vendor admin console. Demo tenant "Troy's Kebabs".

Brand: **Forest `#13301F` + white** (the earlier lime `#76b900` is fully retired).

---

## How to use this bundle

1. Read **`foundation/design-tokens.md`** — the exact, final values (colours, type,
   spacing, radii, shadows, breakpoints). Also `design-tokens.css` as ready-made
   custom properties. **This is the source of truth for values.**
2. Read **`foundation/component-inventory.md`** — the full kit + new components, each
   with its state matrix. Build these as real reusable components first.
3. For each surface, read its **`*-spec.md`** — per-screen purpose, interaction states,
   components used, responsive behaviour, and state-specific copy.
4. Use the **screenshots** in each surface's `screens/` (full screens at each width) and
   `blocks/` (isolated tiles/components) as the visual target.
5. Consult **`reference-prototype/Roster.dc.html`** only to check exact markup/copy —
   **do not port its runtime.** See `reference-prototype/DO-NOT-PORT.md`.

---

## Structure

```
roster-handoff/
├── README.md                     ← this file
├── foundation/
│   ├── design-tokens.md          ← ★ value source of truth
│   ├── design-tokens.css         ← same values as CSS custom properties
│   ├── component-inventory.md    ← full kit + state matrices
│   └── components/               ← isolated component reference PNGs
├── 01-owner/    owner-spec.md · screens/ · blocks/     (desktop 1340 + tablet 768 + mobile 375)
├── 02-kiosk/    kiosk-spec.md · screens/ · blocks/     (tablet)
├── 03-staff/    staff-spec.md · screens/                (mobile)
├── 04-public/   public-spec.md · screens/               (mobile + landing desktop)
├── 05-admin/    admin-spec.md · screens/ · blocks/      (desktop)
└── reference-prototype/
    ├── Roster.dc.html            ← reference only — DO NOT PORT the runtime
    ├── support.js                ← prototype runtime — DO NOT PORT
    └── DO-NOT-PORT.md
```

### Screenshot naming
- `screens/<screen>-desktop.png` / `-tablet.png` / `-mobile.png` — the full screen at that width.
- `screens/<screen>-<state>.png` — a distinct interaction state (e.g. `kiosk-03-wrong`, `xero-connect-pending`).
- `blocks/<screen>-<block>.png` and `foundation/components/<component>.png` — isolated tiles/blocks/components.

The screenshots are **captured from the prototype** and are lower-resolution than the
real thing will be; where a screenshot and a token/spec value disagree, **the spec wins.**

---

## The five surfaces

| # | Surface | Route family | Chrome | Widths |
|---|---|---|---|---|
| 01 | **Owner web app** | `/`, `/rosters`, `/staff`, `/settings`, `/xero`, … | dark top-nav | desktop 1340 / tablet 768 / mobile 375 |
| 02 | **Kiosk** | `/kiosk/:tenant` | standalone dark, full-screen | tablet |
| 03 | **Staff phone** | `/clock/:tenant`, `/me`, `/a` | bare / phone | mobile |
| 04 | **Public** | `/` (marketing), `/r/:tenant`, `/f` | bare | mobile + landing desktop |
| 05 | **Zale IT admin** | `/admin/clients`, `/admin/log` | indigo top-nav | desktop |

34 designed screens/states in total. Every screen is enumerated in its surface spec.

---

## Non-negotiable product guardrails (keep in the copy)

Roster is deliberately **not a payroll product**:
- Labour figures are always **"estimate — hours × rates, not payroll."**
- Leave is **"recorded for scheduling; balances/accruals are managed by your payroll provider."**
- Pay rate is **"informational only."**
- Xero: **"Roster never interprets awards or calculates pay"**, **"Your rules, your pay
  items — Xero does the maths"**, hours push as ordinary time for **a human to finalise**;
  ordinary rate is **read from** Xero, never set by Roster.
- Documents live in the **owner's own Google Drive, not on Roster's servers.**
- Admin impersonation always shows the persistent red **"Acting as {venue} — changes save
  to their LIVE account"** banner + inset frame, and every write is confirmed.

---

## Assets & fonts
- Google Fonts: **Archivo** (400–900), **Public Sans** (400–700), **Material Symbols
  Rounded** (icons, ligature-based; axes `opsz 20..48, wght 100..700, FILL 0..1`).
- No photography or raster logos: the "logo" is a Material `grid_view` glyph tile +
  "ROSTER" wordmark; avatars are coloured initials; the marketing "screenshot" is a live
  HTML mini-grid. None of these need image assets to match.
