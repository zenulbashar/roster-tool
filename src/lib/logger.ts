import pino from "pino";

/**
 * Structured logger. In development we pretty-print; in production we emit JSON
 * lines for log aggregation.
 *
 * NEVER log secrets, tokens, or PII. Redaction below is a safety net, not a
 * licence to pass sensitive data into log calls.
 */
const isProd = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
  redact: {
    paths: [
      "token",
      "*.token",
      "tokenHash",
      "*.tokenHash",
      "password",
      "*.password",
      "email",
      "*.email",
      "*.staffEmail",
    ],
    censor: "[redacted]",
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        },
      }),
});
