# 04 · Public — per-screen spec

**Surface:** unauthenticated public pages. **Primary width:** landing renders both
**desktop ~1180 content** and **mobile ~375**; the roster + shared-form links are
**mobile ~375** (phone). **Chrome:** bare (no app nav). Marketing hero + footer are
dark (`#111827`) with Leaf `#5FA875` accents.

Screenshots: `screens/<screen>-desktop|mobile.png`.

---

### Marketing landing `/` — screens/landing-desktop.png, screens/landing-mobile.png
- **Purpose:** convert. Dark hero → white body. Top-to-bottom:
  - **Top bar:** brand, Features / Pricing links, "Sign in" (ghost) + "Start free" (Leaf).
  - **Hero:** pill "● Built for Australian hospitality"; h1 "Your whole week, **sorted in minutes.**" (Archivo 900/54 → 36 at ≤600; second line accent); sub-paragraph; CTAs "Start free →" (Leaf, glow `0 8px 24px rgba(95,168,117,.30)`) + "See the roster builder" (dark outline); reassurance "No credit card · Flat monthly fee · Cancel anytime".
  - **Product mockup:** a browser-chrome card (traffic lights, lock + URL, "Troy's Kebabs · Week of 23 Jun") containing a read-only mini roster grid, flush to the hero bottom.
  - **Feature row (5 cols):** Schedule, Attendance, Leave, Inventory, Analytics — 46px tint icon tile + title + one-liner (→ 3-col at ≤900, 2-col at ≤600).
  - **"How it works — Three steps. No manual."** 3 outlined cards (01 Add your team / 02 Build your roster / 03 Publish & go).
  - **Pricing band** (tint section): dark card "Flat monthly fee. No per-shift charges. No aggregator cut." + price card **$49/mo** flat, unlimited staff, "Start free", "14-day trial · no card".
  - **Footer** (dark): brand blurb + Product / Support columns + legal row.
- **Responsive:** hero + feature grid reflow at 900/600; hero h1 → 36px at ≤600.

### Public roster `/r/:tenant` — screens/publicroster-mobile.png
- **Purpose:** read-only published week for staff/public. Header: green "Published roster" pill, "Troy's Kebabs", "Week of 23 – 29 Jun · read-only".
- **Content:** per-day groups — sticky day header (name + date + "N on") over per-person rows (shift-colour dot + name + role + time, tabular-nums). Empty day → italic "No one rostered".
- **States:** day with people / empty day.

### Shared form `/f` — screens/sharedform-mobile.png
- **Purpose:** a public link to fill an owner-built form (e.g. new-starter onboarding) with no login. Centered column with brand mark.
- **States:** *valid* — the form to complete → "Submit" → toast "Submitted — thanks! You can close this page."; *expired* (`formExpired`) — an expired/invalid-link state. Footer reiterates documents are stored in the owner's Google Drive, not on Roster.
- **Components:** form controls, Button, brand mark, empty/expired state.
