# ⚠️ Reference prototype — DO NOT PORT THE RUNTIME

`Roster.dc.html` is the **design reference**, included so you can inspect exact
markup, layout, spacing, copy and every toast/interaction string. It is **not**
code to run or copy into the app.

## What this is
A single-file prototype built on a bespoke in-house design runtime (`support.js`).
It uses a custom template dialect — `<x-dc>`, `{{ dotted.holes }}`, `<sc-if>`,
`<sc-for>`, a `class Component extends DCLogic` logic block, and a single-component
state model with a left "prototype rail" screen-switcher.

## What you MUST NOT do
- **Do not port `support.js`** or the `sc-if`/`sc-for`/`{{ }}` template directives.
- **Do not reproduce the left prototype rail** — it's a demo screen-switcher. Real
  navigation is the dark top-nav bar + real routes (owner) / indigo top bar (admin).
- **Do not reproduce the dashboard "New owner / Established" toggle** — those are two
  real data-driven states, not a UI control.
- Do not treat the single-component state blob as an architecture. Split by
  route/feature in the real Next.js + React app.

## What you SHOULD do
- **Recreate** each screen in the production stack (Next.js + React + your existing
  component kit + Drizzle), using the app's real components, routing, styling and data.
- Read this file to lift **exact values**: hex codes, copy, toast strings, field
  shapes, and the honesty/disclaimer wording.
- Reuse the in-file constant arrays as **realistic seed/fixture data & field shapes**:
  `STAFF`, `STAFF_PROFILES`, `ROSTER_PERIODS`, `SHIFT_TYPES`, `SHIFT`, `TIMESHEETS`,
  `TREND`, `REPORT_STAFF`, `LEAVE`, `CERT`, `BADGE`, `STOCK`, `ITEMS`, `SUPPLIERS`,
  `PEOPLE`, `LOCATIONS`, `TEMPLATES`, `NOTIF_EVENTS`, `ME_*`, `REQ`, kiosk/phone state.
  Replace them with API/DB reads backed by Drizzle.

## How to open it
Open `Roster.dc.html` in a browser (it self-boots via `support.js` next to it).
The left rail jumps between all 34 screens/states. Everything you need to see the
intended look and behaviour is in there — but build from the specs + tokens, not
from the template source.

The source of truth for **values** is `../foundation/design-tokens.*`; for **layout,
states and copy** it's the per-surface spec sheets + this prototype.
