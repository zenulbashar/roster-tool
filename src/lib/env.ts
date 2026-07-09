import { z } from "zod";

/**
 * Centralised, validated environment access. Import `env` from here rather than
 * reading `process.env` directly so a missing/invalid variable fails fast and
 * loudly at startup instead of surfacing as a confusing runtime error later.
 */
const baseEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z.string().url(),

  // Auth.js
  AUTH_SECRET: z.string().min(1),
  AUTH_URL: z.string().url().optional(),

  // Public base URL used to build magic links in emails.
  APP_URL: z.string().url().default("http://localhost:3000"),

  // Email. EMAIL_TRANSPORT picks the delivery mechanism:
  //  - "smtp"    -> local SMTP catcher (Mailpit) for development
  //  - "resend"  -> Resend HTTP API for production
  EMAIL_TRANSPORT: z.enum(["smtp", "resend"]).default("smtp"),
  EMAIL_FROM: z.string().default("Roster <roster@example.com>"),

  // SMTP (Mailpit) settings — only required when EMAIL_TRANSPORT=smtp.
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),

  // Resend — only required when EMAIL_TRANSPORT=resend.
  RESEND_API_KEY: z.string().optional(),

  // Cloudflare Turnstile (bot protection on the public form-fill route).
  // Both keys are OPTIONAL here so the app always boots; instead the verify
  // path (src/lib/turnstile.ts) FAILS CLOSED in production when the secret is
  // missing (and logs a warning). The site key is public (NEXT_PUBLIC_*) and is
  // passed from the server page down to the client widget. NOTE: both keys must
  // be set in Vercel before any owner publishes a form; locally use
  // Cloudflare's documented always-pass test keys.
  TURNSTILE_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),

  // Inbound SSO from prompt2eat. The Ed25519 PUBLIC key that verifies handoff
  // tokens — either a public PEM or its base64 (see src/lib/sso/roster-sso.ts).
  // OPTIONAL so the app always boots; the verify path FAILS CLOSED (rejects
  // every handoff) when it is unset. prompt2eat holds the matching private key,
  // so a Roster compromise can never mint a prompt2eat-trusted token.
  PROMPT2EAT_SSO_PUBLIC_KEY: z.string().optional(),

  // Google Drive document storage (owner connects their OWN Drive; this is an
  // ADDITIONAL authorization, NOT a sign-in method — owner Auth.js login is
  // untouched). All four are OPTIONAL here so the app always boots; the connect
  // flow FAILS CLOSED (refuses to start, shows the owner a clear message) when
  // any are missing, so an OAuth token can never be written without encryption.
  //  - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET: the Google Cloud OAuth app.
  //  - GOOGLE_OAUTH_REDIRECT_URI: must EXACTLY match an authorized redirect URI
  //    in the Google Cloud console, e.g.
  //    https://roster.zaleit.com.au/api/integrations/google/callback
  //  - TOKEN_ENCRYPTION_KEY: base64 of 32 random bytes, used to AES-256-GCM
  //    encrypt the stored OAuth tokens at rest. Generate with:
  //      node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  //    The connect flow refuses to store a token if this is unset/invalid.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),

  // Xero Payroll AU integration (owner connects their business's Xero org so
  // APPROVED hours push as DRAFT timesheets — a human finalises pay in Xero;
  // this build has NO pay-run capability). Like Google Drive, this is an
  // ADDITIONAL authorization, NOT a sign-in method (owner Auth.js login is
  // untouched). All three are OPTIONAL so the app always boots; the connect
  // flow FAILS CLOSED (refuses to start, shows a clear message) when any are
  // missing OR when TOKEN_ENCRYPTION_KEY (shared with Drive) is unset/invalid,
  // so an OAuth token can never be written without encryption.
  //  - XERO_CLIENT_ID / XERO_CLIENT_SECRET: the Xero OAuth 2.0 app credentials.
  //  - XERO_OAUTH_REDIRECT_URI: must EXACTLY match a redirect URI registered on
  //    the Xero app, e.g.
  //    https://roster.zaleit.com.au/api/integrations/xero/callback
  XERO_CLIENT_ID: z.string().optional(),
  XERO_CLIENT_SECRET: z.string().optional(),
  XERO_OAUTH_REDIRECT_URI: z.string().url().optional(),
});

const envSchema = baseEnvSchema.superRefine((val, ctx) => {
  // In production we send via Resend, so the API key must be present. Fail at
  // boot rather than silently at first send.
  if (val.EMAIL_TRANSPORT === "resend" && !val.RESEND_API_KEY) {
    ctx.addIssue({
      code: "custom",
      path: ["RESEND_API_KEY"],
      message: "RESEND_API_KEY is required when EMAIL_TRANSPORT=resend",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Surface every problem at once; never log values, only keys.
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
