import NextAuth, { type DefaultSession } from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import Nodemailer from "next-auth/providers/nodemailer";
import Resend from "next-auth/providers/resend";
import { db } from "@/lib/db";
import { users, accounts, sessions, verificationTokens } from "@/lib/db/schema";
import { env } from "@/lib/env";

/**
 * Owner authentication via email magic link (Auth.js v5).
 *
 * - Local dev sends through Mailpit (SMTP); production sends through Resend.
 *   Chosen by EMAIL_TRANSPORT, mirroring the rest of the app's email setup.
 * - Database sessions (the Drizzle adapter stores sessions in Postgres).
 * - `session.user.businessId` is attached so the rest of the app can scope to
 *   the owner's tenant. It is null until the owner completes onboarding.
 */

// Augment the session type with our tenant id.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      businessId: string | null;
    } & DefaultSession["user"];
  }
}

/** Auth.js provider id used when calling signIn() for the magic link. */
export const EMAIL_PROVIDER_ID =
  env.EMAIL_TRANSPORT === "resend" ? "resend" : "nodemailer";

const emailProvider =
  env.EMAIL_TRANSPORT === "resend"
    ? Resend({
        apiKey: env.RESEND_API_KEY ?? "",
        from: env.EMAIL_FROM,
      })
    : Nodemailer({
        server: {
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          // Mailpit accepts plain SMTP with no TLS or auth in development.
          secure: false,
        },
        from: env.EMAIL_FROM,
      });

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  trustHost: true,
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/sign-in/check-email",
    // Route auth failures (e.g. an expired/used magic link) to our own sign-in
    // page with the code in `?error=`, instead of Auth.js's built-in error page
    // whose "Sign in" button leads to a dead-end Error page. The sign-in page
    // shows a friendly message and lets the user request a fresh link.
    error: "/sign-in",
  },
  providers: [emailProvider],
  callbacks: {
    session({ session, user }) {
      // With the database strategy, `user` is the full row from our users
      // table, so it carries our custom businessId column.
      session.user.id = user.id;
      session.user.businessId =
        (user as { businessId?: string | null }).businessId ?? null;
      return session;
    },
  },
});
