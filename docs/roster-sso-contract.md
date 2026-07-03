# Roster SSO — the Roster-side contract (Track C)

prompt2eat hands a signed, single-use token to Roster so an owner can open Roster
without a second password. **Identity stores stay separate** (decision D5,
email-level linking): no shared cookie, no shared user table, no shared secret.
prompt2eat holds the Ed25519 **private** key; Roster holds only the **public**
key. This document is the exact contract the Roster app (`zenulbashar/roster-tool`,
roster.zaleit.com.au) implements — the inbound side lives here.

## 1. Keys (one-time setup)

Generate an Ed25519 keypair:

```
openssl genpkey -algorithm ed25519 -out roster-sso-priv.pem
openssl pkey -in roster-sso-priv.pem -pubout -out roster-sso-pub.pem
```

- **prompt2eat** env `ROSTER_SSO_PRIVATE_KEY` = base64 of the PRIVATE PEM:
  `base64 -w0 roster-sso-priv.pem`
- **Roster** env `PROMPT2EAT_SSO_PUBLIC_KEY` = the PUBLIC PEM (or its base64).

Rotation is one-sided: replace the keypair, update both envs. A Roster
compromise cannot mint prompt2eat-trusted tokens (it never holds the private
key).

## 2. The token (what prompt2eat sends)

A compact JWS, `header.payload.signature` (all base64url), **EdDSA / Ed25519**.

- Header: `{ "alg": "EdDSA", "typ": "JWT" }`
- Payload claims:
  | claim | value |
  |---|---|
  | `iss` | `"prompt2eat"` (verify exact) |
  | `aud` | `"roster"` (verify exact) |
  | `iat` | issued-at (unix seconds) |
  | `exp` | `iat + 60` — **≤60s lifetime** |
  | `jti` | random UUID — **single-use**, for replay protection |
  | `email` | the owner's **verified** email (Auth.js magic-link) — the match key |
  | `name` | display name, best-effort (greeting only) |
  | `venue` | `{ id, slug, name }` — **CONTEXT ONLY** (display/prefill). Per D5, Roster must NOT treat this as an org key. |
  | `entitlements` | `{ roster: boolean }` — whether the venue holds the paid Roster add-on. Roster decides what `false` means (trial / read-only / prompt to subscribe). Build 5 sets this true on purchase. |

## 3. Delivery (how it arrives)

The browser submits a cross-origin **POST** (target `_blank`) to
`POST https://roster.zaleit.com.au/api/sso/prompt2eat` with a single form field
`token=<JWS>`. The token is in the **body, never a query string**, so it never
lands in a URL, referrer, or access log. (prompt2eat's endpoint is configurable
via its `ROSTER_SSO_URL` env; default is the URL above.)

## 4. What Roster implements — `POST /api/sso/prompt2eat`

The route (`src/app/api/sso/prompt2eat/route.ts`) does exactly this:

1. Read `token` from the POST body.
2. **Verify the EdDSA signature** against the pinned public key
   (`src/lib/sso/roster-sso.ts`, `node:crypto` `crypto.verify(null, …)`). Reject
   on failure. Fails **closed** when the key is unset.
3. **Verify `iss === "prompt2eat"` and `aud === "roster"`** (exact match) and the
   `EdDSA` header alg (no `alg: none` downgrade).
4. **Verify `exp`** with a ≤30s clock-skew allowance, that `iat` is not in the
   future beyond that skew, and that the lifetime (`exp - iat`) is ≤60s.
5. **Replay protection:** insert `jti` into `sso_consumed_tokens` (unique `jti`,
   `seen_at`; `src/lib/sso/replay.ts`). An `onConflictDoNothing` that returns no
   row ⇒ **reject** (already used). Rows older than ~10 minutes are GC'd.
6. **Match-or-provision the user BY VERIFIED EMAIL** in Roster's OWN `user` table
   (case-insensitive; `src/lib/auth/sso-session.ts`). Never reads/writes any
   prompt2eat cookie/table.
7. **Create Roster's OWN Auth.js session** (a `session` row + the
   `authjs.session-token` cookie the DrizzleAdapter reads) and **303-redirect to
   a FIXED path** (`/app` — Roster's owner dashboard; a new owner with no
   business is then routed to onboarding). No redirect parameter ⇒ no
   open-redirect surface.
8. On ANY verification failure, redirect to `/sign-in?error=sso` with a generic
   message (never echo token contents).

`entitlements.roster` and the `venue` context are available for Roster's own
onboarding/greeting, but membership/tenancy remain entirely Roster's concern.

> **Path note:** the generic contract names `/dashboard` and `/signin`; Roster's
> actual routes are `/app` (owner dashboard) and `/sign-in`. The security
> property that matters — a fixed landing path with no redirect param — holds.

## 5. Security properties (why this is safe)

- **Replay** — `jti` single-use (step 5).
- **Leakage** — POST body + ≤60s TTL + single-use; never logged by either app.
- **Forgery** — asymmetric signature; Roster can verify but not mint.
- **Clock skew** — ±30s allowance on `exp`/`iat`.
- **Open redirect** — fixed landing path, no redirect param.
- **Downgrade / audience confusion** — `iss`/`aud`/`alg` pinned.
- **Cross-app firewall** — no shared session, cookie, user table, or secret in
  either direction.

## 6. Roster side — where it lives

- `src/lib/sso/roster-sso.ts` — token decode + EdDSA verify + claim validation
  (pure `validateHandoffClaims`, key-injectable `verifyHandoffTokenWithKey`,
  env-pinned `verifyRosterHandoffToken`).
- `src/lib/sso/replay.ts` — `consumeJti` / `gcConsumedTokens` single-use guard.
- `src/lib/auth/sso-session.ts` — `matchOrProvisionUser`, `createDbSession`,
  `sessionCookieConfig` (programmatic sign-in for the database-session strategy).
- `src/app/api/sso/prompt2eat/route.ts` — the POST handler wiring the above.
- `sso_consumed_tokens` table — migration `drizzle/0017_new_banshee.sql`.
- Env: `PROMPT2EAT_SSO_PUBLIC_KEY` (`src/lib/env.ts`, optional → fail-closed).
- Tests: `tests/roster-sso.test.ts` (verify/reject matrix),
  `tests/roster-sso-flow.test.ts` (replay + provision + session against Postgres).

## 7. prompt2eat side (the minting half, in the order-tool repo)

- `lib/sso/roster.ts` — `mintRosterHandoffToken(claims)`, `getRosterSSOUrl()`.
- `app/dashboard/apps/actions.ts` — `createRosterHandoff()` server action.
- `app/dashboard/apps/launch-roster.tsx` — POSTs the token in a new tab (body).
- `venues.roster_entitled` feeds `entitlements.roster`.
