# Security policy

Roster holds rosters, clock-in records, pay rates and leave for small
businesses, and connects to owners' Google Drive and Xero accounts. Security
issues are treated as production incidents.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's
**Security → Report a vulnerability** on this repository (private
vulnerability reporting), not in a public issue or pull request. Include the
affected route or component, steps to reproduce, and the impact you believe it
has. You will get an acknowledgement within two business days and a status
update when the fix ships.

## Remediation targets

| Severity (CVSS)     | Target to fix or mitigate in production |
| ------------------- | --------------------------------------- |
| Critical (9.0–10.0) | 7 days                                  |
| High (7.0–8.9)      | 30 days                                 |
| Moderate (4.0–6.9)  | 90 days                                 |
| Low                 | next scheduled dependency update        |

"Mitigate" means the vulnerable code path is provably unreachable in this
deployment and the reasoning is recorded in the register below, with a date
to revisit.

## How dependencies are kept current

- **Dependabot** (`.github/dependabot.yml`) opens one grouped minor/patch npm
  PR each week (majors on their own) plus GitHub Actions bumps. Enable
  _Dependabot alerts_ and _Dependabot security updates_ in the repository
  settings so advisory-driven PRs arrive as soon as an advisory is published.
- **CI gate**: every push and PR runs `npm audit --audit-level=high --omit=dev`
  — any high or critical advisory in a **production** dependency fails the
  build. Dev-only tooling is reported but does not block.
- **SBOM**: CI generates a CycloneDX software bill of materials of the
  production dependency tree on every run (`sbom` artifact), for customer
  security questionnaires and incident triage.
- **Tests as guards**: the tenant-isolation suite calls every mutating
  repository method with another tenant's ids and asserts nothing changes; the
  coverage ratchet stops test coverage regressing; the pay-rules boundary tests
  pin the "Roster calculates no pay" invariant.

## Accepted-risk register

Every entry is a knowing, recorded exception with a mitigation and a review
trigger. An entry without a mitigation is a bug, not an exception.

| Package                                                 | Risk                                                                                                                                                                                                          | Mitigation                                                                                                                                                                                                                                                                                                                                                                            | Review trigger                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `next-auth` 5.0.0-beta.x (Auth.js)                      | Pre-release authentication library. There is no stable v5; v4 (4.24.x) is a different, pages-router-era API and sits on the same `@auth/core` advisory chain.                                                 | `@auth/core` is at 0.41.3, the release that fixes the email-normaliser homoglyph bypass, the malformed-`Bearer` exception and the OAuth check-cookie binding. Only the email magic-link providers are configured (no OAuth provider, so the check-cookie advisory has no reachable surface); sessions are database-backed; `nodemailer` is forced to 10.x everywhere via `overrides`. | Each Dependabot beta bump is reviewed; move to v5 stable when it ships. |
| `nodemailer` pinned above Auth.js's declared peer range | Auth.js declares `nodemailer ^7 \|\| ^8`; both ranges carry high advisories (SMTP command injection, CRLF header injection, raw-option file read/SSRF). `overrides.nodemailer` forces 10.0.0 into every copy. | Nodemailer 10 keeps the `createTransport`/`sendMail` API this app uses; the app never passes `envelope`, `raw`, `List-*` headers or a transport `name` from user input. Verified by the full suite and a production build.                                                                                                                                                            | Remove the override when Auth.js widens its peer range.                 |

## Scope notes for reviewers

- Owners sign in by email magic link only; staff never have accounts — they
  use per-business capability links (kiosk, personal-phone clock-in, `/me`) plus
  a per-person PIN with an escalating lockout and a per-device attempt cap.
- Every domain row is tenant-scoped (`business_id`), derived server-side from
  the session or a validated token, never from request input. See
  `CLAUDE.md` → _Non-negotiable conventions_.
- Third-party tokens (Google Drive, Xero) are stored AES-256-GCM encrypted and
  the Xero client has no code path to a pay run.
