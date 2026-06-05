import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

let transporter: Transporter | null = null;
let resend: Resend | null = null;

function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false,
  });
  return transporter;
}

/**
 * Send a transactional email. Uses Resend in production and SMTP (Mailpit) in
 * development, chosen by EMAIL_TRANSPORT. Throws on failure so the calling job
 * fails and pg-boss retries. Never logs recipient PII beyond what the redacting
 * logger allows.
 */
export async function sendEmail(msg: OutgoingEmail): Promise<void> {
  if (env.EMAIL_TRANSPORT === "resend") {
    if (!env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is required when EMAIL_TRANSPORT=resend");
    }
    resend ??= new Resend(env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    if (error) {
      throw new Error(`Resend failed: ${error.name}: ${error.message}`);
    }
  } else {
    await getTransporter().sendMail({
      from: env.EMAIL_FROM,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  }
  logger.info({ subject: msg.subject }, "Email sent");
}
