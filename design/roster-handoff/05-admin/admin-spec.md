# 05 · Zale IT admin — per-screen spec

**Surface:** platform operations back-office for the vendor ("Zale IT"), separate from
any tenant. **Primary width:** desktop ~1340. **Chrome:** dedicated **indigo** top bar
(bg `#1E1B4B`): `shield_person` mark + "ROSTER" (`#A5B4FC`) + **ADMIN** badge · "Zale IT ·
Platform operations" · tabs **Clients / Activity log** (active = white + `inset 0 -2px 0
#A5B4FC`) · right: "Priya · Zale IT" + avatar. Content capped 1340.

Screenshots: `screens/<screen>-desktop.png`; impersonation blocks in `blocks/`.

---

### Clients overview `/admin/clients` — screens/adminclients-desktop.png
- **Purpose:** every Roster venue on the platform. h1 "Client businesses" + "Open a client, or view as their venue to support them."
- **Content:** 4 KPI tiles (indigo numbers `#312E81`); search field + filter chips (All/Active/Trial/Paused, selected = `#312E81` fill); clients table — Business (+ status badge) / Plan / Sites / Staff / Integrations (Xero + Drive chips) / Last active / **View as** button (`#312E81`, `visibility` icon).
- **Interactions:** click business → client detail; "View as" → **impersonation entry modal** (below).

### Client detail `/admin/clients/:id` — screens/adminclient-desktop.png
- **Purpose:** one venue's account summary. Back link "All clients"; header name + status badge + "{plan} plan · N locations · N staff · last active …"; primary "View as venue" (`#312E81`, elevated).
- **Content:** cards — Plan & billing (plan · $49/mo, billing status "Paid · next 1 Jul", customer since); Integrations (Xero + Google Drive rows with connected/label chips); full-width "Recent admin activity on this client" list (tag + action + detail + time).

### Admin activity log `/admin/log` — screens/adminlog-desktop.png
- **Purpose:** every admin action across clients. h1 + "who did what, on whose account. Write actions are flagged for accountability." Table: Type (tag; **write** actions flagged) / Admin / Action + detail / Venue / When.

---

## Impersonation ("View as venue") — blocks/impersonation-banner.png, blocks/impersonation-entry-modal.png, blocks/impersonation-write-modal.png

The safety system that lets an admin operate inside a live tenant. Build faithfully —
the wording and the ever-present red framing are the point.

### Entry confirm modal (`hasImpEntry`)
Red-headed modal "**View as venue — live account**". Body: "You're about to enter
**{venue}** and act as their venue. You'll have **full read and write access** to their
live account — including rosters, staff pay-rate inputs and Xero mappings." + "Anything
you change saves to their real data. A red banner will stay on screen the whole time so
you don't forget." Buttons: Cancel / "Enter live account" (`#B91C1C`, `visibility`).
On confirm → enters the owner app as that venue (`dashView:established`, lands on dashboard).

### Persistent impersonation banner (`impersonating`) ★
Fixed top bar, **52px**, `#B91C1C` + 45° stripe overlay, shadow `0 3px 14px
rgba(185,28,28,.4)`; filled `warning` icon + **"Acting as {venue} — changes save to
their LIVE account."** (`LIVE account` bold + underlined) + "Exit to admin" (white bg,
`#B91C1C` text, `logout`). Also renders a fixed **full-viewport inset frame `4px
#DC2626`** and pushes all app content down by 52px. Stays up for the entire session.
Exit → clears impersonation, returns to Clients overview.

### Write-confirm modal (`hasImpWrite`) ★
Every write attempt while impersonating is intercepted. Modal (2px `#DC2626` border):
`edit_note` icon + action title (e.g. "Publish roster"), danger box "**Writing to
{venue}'s live account.** {context}", Cancel / "Save to live account" (`#B91C1C`).
Confirm runs the pending write; cancel aborts it. E.g. Publish → context "This publishes
the roster and notifies 6 staff on {venue}'s live account."; Push hours → "This pushes
hours to {venue}'s live Xero for a human to finalise."

**Components:** admin top bar, KpiTile (indigo), clients table, tag badges, impersonation
banner ★, entry modal ★, write-confirm modal ★. **States:** clients list (filters) ·
client detail · activity log · entry-confirm open · impersonating (banner + framed app) ·
write-confirm open.
