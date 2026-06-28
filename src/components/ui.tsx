import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Tiny, dependency-free UI kit. High-contrast, large tap targets, semantic
 * markup. Kept intentionally small so the product stays obvious and easy to
 * change.
 *
 * Type system: Archivo (--font-display, via .font-archivo) for headings,
 * badges and primary buttons; Public Sans (--font-sans, the body default) for
 * everything else.
 */

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] min-h-11 disabled:opacity-50 disabled:cursor-not-allowed";

const variants = {
  // Primary actions: Zaleit green with dark text (links/info stay blue).
  primary:
    "font-archivo font-bold text-[13.5px] tracking-[0.01em] px-[18px] py-[11px] bg-[var(--color-button)] text-[var(--color-button-ink)] hover:bg-[var(--color-accent-dark)] shadow-[0_1px_2px_rgba(17,24,39,0.10)]",
  secondary:
    "font-semibold text-[13px] px-[14px] py-[10px] bg-[var(--color-surface)] text-[#374151] border border-[var(--color-border)] hover:bg-[var(--color-bg)] hover:border-[var(--color-line)]",
  danger:
    "font-semibold text-[13.5px] px-[18px] py-[11px] bg-[var(--color-danger)] text-white hover:opacity-90",
} as const;

type Variant = keyof typeof variants;

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return (
    <button
      className={`${buttonBase} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return (
    <Link
      className={`${buttonBase} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-card)] ${className}`}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-[var(--color-ink)]">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-sm text-[var(--color-muted)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function TextInput({
  className = "",
  ...props
}: ComponentProps<"input">) {
  return (
    <input
      className={`block w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-ink)] ${className}`}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="font-archivo text-[25px] font-extrabold tracking-[-0.015em] text-[var(--color-text)]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-[var(--color-text-secondary)]">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "warn";
  children: ReactNode;
}) {
  // Info stays blue (links/info banners are deliberately not green).
  const tones = {
    info: "bg-[var(--color-info-bg)] text-[var(--color-brand)] border-blue-200",
    success:
      "bg-[var(--color-success-bg)] text-[var(--color-ok)] border-[var(--color-success-border)]",
    warn: "bg-[var(--color-warning-bg)] text-[var(--color-warn)] border-amber-200",
  } as const;
  return (
    <div
      role="status"
      className={`rounded-[var(--radius-md)] border px-4 py-3 text-sm font-medium ${tones[tone]}`}
    >
      {children}
    </div>
  );
}

/**
 * Status badge — consistent across leave, certs, timesheets, stock,
 * notifications, roster status, etc. Archivo 700, small, uppercase.
 */
const badgeTones = {
  success:
    "text-[var(--color-success)] bg-[var(--color-success-bg)] border-[var(--color-success-border)]",
  warning: "text-[var(--color-warning)] bg-[#FDF3C0] border-transparent",
  danger:
    "text-[var(--color-danger-strong)] bg-[var(--color-danger-bg)] border-transparent",
  draft: "text-[#6B7280] bg-[#F3F4F6] border-[var(--color-border)]",
  info: "text-[var(--color-info)] bg-[var(--color-info-bg)] border-blue-200",
} as const;

export type BadgeTone = keyof typeof badgeTones;

export function Badge({
  tone = "draft",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`font-archivo inline-flex items-center rounded-[var(--radius-sm)] border px-[9px] py-[3px] text-[11px] font-bold uppercase tracking-wide ${badgeTones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
