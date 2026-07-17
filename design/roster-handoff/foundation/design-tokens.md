# Roster — Design Tokens & Style Spec (source of truth)

> These are the **exact final values as built** in the Forest-brand prototype
> (`Roster.dc.html`). Translate them into the app's real styling layer
> (Tailwind theme, CSS variables, a tokens file — whatever the codebase uses).
> Where a value appears both here and in a screenshot, **this file wins.**
>
> Brand: **Forest `#13301F` + white**. The old lime `#76b900` is fully retired.
> Blue `#1D4ED8` and the semantic status colours were intentionally left untouched
> during the Forest migration.

---

## 1. Core brand & accent

| Token | Hex | Use |
|---|---|---|
| `--forest` (accent fill, light surfaces) | `#13301F` | Primary buttons, active nav, count pills, selected states, KPI hero numbers, links |
| `--forest-hover` | `#1D4A2E` | Hover on Forest fills |
| `--on-forest` | `#FFFFFF` | Text/icons on Forest fills |
| `--leaf` (accent on DARK surfaces) | `#5FA875` | Brand wordmark + primary action on dark chrome: top nav, kiosk, phone clock-in, landing hero, footer. ≥4.5:1 on `#111827` |
| `--leaf-hover` | `#4E9666` | Hover on Leaf fills (dark surfaces) |

**Green text tones** (text/icon on light or tinted surfaces) — all collapse to Forest family:
`#13301F` (primary), `#1D4A2E` (Morning shift label), `#2E7D4E` (Morning shift stripe/time, secondary green text).

---

## 2. Neutrals & surfaces

| Token | Hex | Use |
|---|---|---|
| Ink / near-black | `#111827` | Primary text; dark top-nav bg; dark buttons |
| Dark-nav dividers | `#1F2937`, `#374151`, `#2A3344` | Borders/dividers on dark surfaces |
| Text secondary | `#374151` | Body copy |
| Text muted | `#6B7280` | Sub-labels, captions |
| Text faint | `#9CA3AF` | Meta, placeholders, faint icons |
| Border | `#E5E7EB` | Card borders, inputs, dividers |
| Border faint | `#F1F3F5`, `#F3F4F6` | Inner dividers, row separators |
| App background | `#F9FAFB` | Page background |
| Surface | `#FFFFFF` | Cards, panels |
| Surface faint | `#FAFBFC`, `#FCFCFB`, `#FCFDFC` | Table headers, card footers, hover fills |

---

## 3. Forest tints (replace old lime tints)

| Token | Hex | Use |
|---|---|---|
| Tint pale | `#ECF3EE` | Active rail item, badges, callouts, Morning tint, icon tiles |
| Tint 2 | `#E3EEE7` | Count pills, "OK"/lent-site chips, badges |
| Tint border | `#CFE3D6` | Border on tinted surfaces |
| Tint hover | `#E0EDE4` | Hover on tinted surfaces |
| Grid hover bg | `#EDF4EF` | Roster-builder empty-cell / geofence map bg |
| Grid empty-hover accent | `#7DA98A` | Empty roster cell hover accent |

---

## 4. Semantic / status (unchanged through Forest migration)

Badges are: uppercase Archivo, ~9.5–11px, weight 700, letter-spacing .04–.05em, padding ~4×9px, radius 6px, `1px solid <border>`.

| Meaning | Text | Background | Border | Badge labels using it |
|---|---|---|---|---|
| Success / valid / approved / published / OK-active | `#15803D` | `#ECFDF3` | `#BBF7D0` | PUBLISHED, APPROVED, VALID, LIVE, ACTIVE |
| Warning / pending / expiring / collecting | `#B45309` | `#FEF3E2` | `#FED7AA` | PENDING, EXPIRING SOON, COLLECTING AVAILABILITY |
| Danger / denied / expired / needs-order / no-clock-out | `#B91C1C` | `#FEECEC` | `#FECACA` | DENIED, EXPIRED, NEEDS ORDER, NO CLOCK-OUT |
| Info / still-clocked-in | `#1D4ED8` | `#EFF6FF` | `#BFDBFE` | STILL CLOCKED IN |
| Neutral / draft | `#6B7280` | `#F3F4F6` | `#E5E7EB` | DRAFT, NONE RECORDED |
| Forest "OK" (stock) | `#13301F` | `#E3EEE7` | `#CFE3D6` | OK |

Standalone danger/alert red (icons, badge dot, GPS block, impersonation): `#DC2626`.
Warning accent used inline (e.g. "+18h pending", estimate warnings): `#D97706`.

---

## 5. Shift-type palette (roster grid colour coding)

Each shift renders as a tinted card with a `3px` coloured left stripe, shift name in `label`, time in `time`.

| Shift | Stripe | Tint bg | Label text | Time text | Hours (shift-types page) |
|---|---|---|---|---|---|
| Morning | `#2E7D4E` | `#ECF3EE` | `#1D4A2E` | `#2E7D4E` | 6:00am – 2:00pm |
| Arvo / Afternoon | `#7C5CBF` | `#F2EEFB` | `#5B43A6` | `#6E57B8` | 2:00pm – 10:00pm |
| Close | `#1E293B` | `#EEF1F5` | `#1E293B` | `#566476` | 6:00pm – close |
| Split | `#D97706` | `#FDF2E3` | `#B45309` | `#C26A0C` | Varies |

**Availability dots:** Available `#16A34A` · Partial `#D97706` · Off/No-response `#9CA3AF` · pending/not-yet `#E5E7EB`.

**Category chips (items/suppliers):** Meat `#B91C1C/#FEECEC` · Produce `#5A7D17/#F0F6E2` · Packaging `#475569/#EEF1F5` · Beverages `#1D4ED8/#EFF6FF` · Bakery `#B45309/#FDF2E3`.

**Staff avatar colours** (initials, white text on solid circle):
Sarah `#C2683B` · Jake `#5B6B7B` · Marcus `#A67C00` · Aisha `#8E5A9E` · Tom `#2F7D6B` · Priya `#B5524E` · Liam `#6B7280`.

---

## 6. Sub-brand palettes (non-owner surfaces)

**Kiosk / phone clock-in (dark):** bg radial `#1a2335 → #0E1320`; tiles `#1C2433`; tile border `#2A3344`; primary action = Leaf `#5FA875` on `#111827` text; success panel `#14532D`/border `#166534`; danger panel `#3B1414`/border `#7F1D1D`; lock panel `#26314A`.

**Zale IT admin (indigo):** top-nav bg `#1E1B4B`; nav divider/accent `#312E81`, `#4338CA`; wordmark `#A5B4FC`; light text `#C7D2FE`; active tab underline `#A5B4FC`; KPI numbers `#312E81`; primary "View as" button `#312E81` → hover `#4338CA`.

**Impersonation (danger):** persistent banner bg `#B91C1C` (with 45° 14px repeating stripe overlay at 6% black); full-viewport inset frame `4px #DC2626`; entry/confirm modals headed `#B91C1C`, confirm buttons `#B91C1C` → hover `#991B1B`.

**Xero brand:** logo tile `#13B5EA`; pale tint `#E0F5FC`.

---

## 7. Typography

Three Google font families:
- **Archivo** (400–900) — display/headings, numbers, labels, badges, brand wordmark. Heavy weights (700–900). Headings `letter-spacing:-.015em to -.025em`; uppercase labels `.05–.09em`.
- **Public Sans** (400–700) — body, buttons, form controls, secondary text.
- **Material Symbols Rounded** — all icons, referenced by ligature name (`grid_view`, `schedule`, `beach_access`, `verified`, `local_shipping`, `notifications`, `sync_alt`, `location_on`…). Axes used: `opsz 20..48, wght 100..700, FILL 0..1, GRAD -50..200`.
- Monospace (`ui-monospace, monospace`) — SKUs, ABN, PIN/link tokens, "[ map preview ]", notice detail chips.

**Type scale (px):**

| Role | Size / weight |
|---|---|
| Marketing hero h1 | 54 / 900 (→ 36 at ≤600px) |
| Dashboard / onboarding h1 | 27 / 800 |
| Page h1 (owner/admin) | 25 / 800 |
| Client-detail h1 | 26 / 800 |
| Section h2 (marketing) | 30–34 |
| Panel title | 19–20 / 800 |
| Card title | 15–16 / 700 |
| KPI number | 30 / 800 (admin 29) |
| Body | 13–15 |
| Meta / caption | 11–12.5 |
| Uppercase eyebrow label | 10–11 / 700, letter-spacing .05–.09em |

---

## 8. Spacing, radius, shadow, layout

- **Radius:** inputs/buttons `9–11px`; cards `14px`; large panels `16–18px`; pills `20–30px`; avatars `50%`; chips `5–8px`; kiosk keys/tiles `15–18px`.
- **Card shadow (resting):** `0 1px 2px rgba(17,24,39,.04)` (or `0 1px 3px rgba(17,24,39,.05)`).
- **Elevated:** nav dropdown `0 18px 40px rgba(17,24,39,.20)`; bell `0 22px 52px rgba(17,24,39,.24)`; modals `0 30px 70px rgba(0,0,0,.4)`; off-canvas rail `0 24px 60px rgba(17,24,39,.32)`; toast `0 16px 40px rgba(0,0,0,.28)`.
- **Shift-cell hover lift:** `translateY(-1px)` + `0 5px 14px rgba(17,24,39,.11)`.
- **Focus ring:** `0 0 0 3px rgba(19,48,31,.18–.20)` (Forest) on light; `0 0 0 3px rgba(29,78,216,.35–.55)` (blue) on kiosk/phone/keypad controls.
- **Content max-width:** `1340px`; owner/admin page padding `26px 30px 80px`.
- **Toggle switch:** 44×26 track, 20px knob; on-track `#13301F` (site GPS) / `#5FA875` where on dark; off-track `#E5E7EB`.
- **KPI tile:** white, `1px #E5E7EB`, radius 14, padding 18, resting card shadow; label 12.5 muted 600 + faint icon top-right; number Archivo 800/30 coloured per metric; sub-line 12.5.

---

## 9. Motion (keyframes in source)

- `rosterFade` .14–.15s ease — dropdowns/menus.
- `rosterToast` .26s ease — toast slide-up from bottom-right (check icon Leaf `#5FA875`).
- `rosterPulse` 2.2s infinite — unread bell badge ping, **stays RED `#DC2626`**.
- `rosterShimmer` — skeleton loading (defined, available).
- Nav / hover transitions `.12–.16s`; rail slide `.24s cubic-bezier(.4,0,.2,1)`.
- All non-essential motion disabled under `prefers-reduced-motion: reduce`.

---

## 10. Responsive breakpoints

- **≤1023px** — top nav hidden; (the prototype's rail becomes an off-canvas drawer + hamburger — in production this maps to your real mobile nav). Header padding shifts.
- **≤900px** — multi-column grids reflow (5→3, 4→2, 3/2→1; side-splits stack).
- **≤600px** — 5→2 and 4→1 grids; kiosk grid → 2-col; hero h1 → 36px.
- Content capped at 1340px; wide tables scroll inside their own container; roster builder keeps a **sticky first column + sticky header**; tap targets ≥44px; kiosk keypad keys 70px tall, phone keys 60–62px.

See `design-tokens.css` for the same values as CSS custom properties.
