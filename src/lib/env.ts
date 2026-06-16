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
