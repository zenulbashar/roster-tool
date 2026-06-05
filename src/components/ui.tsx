import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Tiny, dependency-free UI kit. High-contrast, large tap targets, semantic
 * markup. Kept intentionally small so the product stays obvious and easy to
 * change.
 */

const buttonBase =
  "inline-flex items-center justify-center rounded-lg px-5 py-3 text-base font-semibold min-h-12 disabled:opacity-50 disabled:cursor-not-allowed";

const variants = {
  primary:
    "bg-[var(--color-brand)] text-[var(--color-brand-ink)] hover:opacity-90",
  secondary:
    "bg-[var(--color-surface)] text-[var(--color-ink)] border border-[var(--color-line)] hover:bg-[var(--color-canvas)]",
  danger: "bg-[var(--color-danger)] text-white hover:opacity-90",
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
      className={`rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5 ${className}`}
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
      className={`block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-ink)] ${className}`}
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
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-ink)]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-[var(--color-muted)]">{subtitle}</p>
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
  const tones = {
    info: "bg-blue-50 text-[var(--color-brand)] border-blue-200",
    success: "bg-green-50 text-[var(--color-ok)] border-green-200",
    warn: "bg-amber-50 text-[var(--color-warn)] border-amber-200",
  } as const;
  return (
    <div
      role="status"
      className={`rounded-lg border px-4 py-3 text-sm font-medium ${tones[tone]}`}
    >
      {children}
    </div>
  );
}
