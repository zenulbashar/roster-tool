import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { avatarColor, initials as toInitials } from "@/lib/avatar";

/**
 * Dependency-free UI kit matching the "Roster" design handoff (see
 * `design/handoff/`). High-contrast, large tap targets, semantic markup.
 *
 * Type system: Archivo (--font-display, via .font-archivo) for headings,
 * numbers, badges and primary buttons; Public Sans (--font-sans, the body
 * default) for everything else. Green (`#76b900`) is reserved for primary
 * actions and active states; blue (`--color-brand`) for links/focus/info.
 */

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] min-h-11 whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const variants = {
  // Primary actions: Zaleit green with dark text (links/info stay blue).
  primary:
    "font-archivo font-bold text-[13.5px] tracking-[0.01em] px-[17px] py-[11px] bg-[var(--color-button)] text-[var(--color-button-ink)] hover:bg-[var(--color-accent-dark)] shadow-[0_1px_2px_rgba(17,24,39,0.10)]",
  secondary:
    "font-semibold text-[13px] px-[14px] py-[10px] bg-[var(--color-surface)] text-[#374151] border border-[var(--color-border)] hover:bg-[var(--color-bg)] hover:border-[var(--color-line)]",
  // Dark ink button (e.g. the supplier "Add" form, kiosk secondary CTAs).
  dark: "font-archivo font-bold text-[13.5px] px-[17px] py-[11px] bg-[var(--color-ink)] text-white hover:bg-[#1f2937]",
  // Low-emphasis text button.
  ghost:
    "font-semibold text-[13px] px-[12px] py-[9px] bg-transparent text-[#374151] hover:bg-[var(--color-bg)]",
  danger:
    "font-semibold text-[13.5px] px-[16px] py-[11px] bg-[var(--color-danger)] text-white hover:opacity-90",
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

/** Square icon-only button (e.g. copy/share/edit affordances). */
export function IconButton({
  className = "",
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      className={`inline-flex h-[42px] w-[42px] items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[#374151] transition-colors hover:bg-[var(--color-bg)] ${className}`}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

/** Material Symbols Rounded ligature icon. `fill` for the filled variant. */
export function Icon({
  name,
  className = "",
  fill = false,
}: {
  name: string;
  className?: string;
  fill?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-rounded ${fill ? "fill" : ""} ${className}`}
    >
      {name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  /** Set false for tables/lists that own their internal padding. */
  padded?: boolean;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] ${
        padded ? "p-5" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Card with an uppercase eyebrow header bar + body (Account / Clock-in /
 * Notifications cards in Settings, section blocks on the Staff detail panel).
 */
export function SectionCard({
  title,
  children,
  className = "",
  bodyClassName = "p-[18px]",
}: {
  title: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] ${className}`}
    >
      <div className="border-b border-[var(--color-border-subtle)] px-[18px] py-[14px]">
        <Eyebrow>{title}</Eyebrow>
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

/** Uppercase Archivo micro-label used for section headers. */
export function Eyebrow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`font-archivo text-[11px] font-bold uppercase tracking-[0.07em] text-[var(--color-text-muted)] ${className}`}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

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
      <span className="mb-[7px] block text-[12.5px] font-semibold text-[#374151]">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-1.5 block text-[12px] text-[var(--color-text-muted)]">
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
      className={`block w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-[14px] py-[11px] text-[14.5px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-button)] focus:ring-[3px] focus:ring-[rgba(118,185,0,0.16)] ${className}`}
      {...props}
    />
  );
}

/**
 * Presentational toggle switch (44×26 track, 20px knob) matching the design.
 * The actual on/off change is driven by the surrounding form/action — this only
 * renders the visual state from `on`.
 */
export function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-block h-[26px] w-[44px] flex-shrink-0 rounded-full transition-colors ${
        on ? "bg-[var(--color-button)]" : "bg-[var(--color-line)]"
      }`}
    >
      <span
        className={`absolute left-[3px] top-[3px] h-[20px] w-[20px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform ${
          on ? "translate-x-[18px]" : "translate-x-0"
        }`}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page header
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  action,
  size = "md",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** md = 25px (most owner pages); lg = 27px (dashboard/onboarding). */
  size?: "md" | "lg";
}) {
  return (
    <header className="mb-[18px] flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1
          className={`font-archivo font-extrabold tracking-[-0.015em] text-[var(--color-text)] ${
            size === "lg" ? "text-[27px]" : "text-[25px]"
          }`}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1.5 text-[13.5px] text-[var(--color-text-secondary)]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

/**
 * Initials-on-a-solid-circle avatar (deterministic colour from the person's id
 * or name). `size` is the diameter in px.
 */
export function Avatar({
  name,
  colorKey,
  size = 32,
  className = "",
}: {
  name: string;
  colorKey?: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-full font-archivo font-bold text-white ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        backgroundColor: avatarColor(colorKey || name),
      }}
    >
      {toInitials(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// KPI tile
// ---------------------------------------------------------------------------

export function KpiTile({
  label,
  value,
  sub,
  icon,
  iconColor = "var(--color-text-muted)",
  valueColor = "var(--color-ink)",
  href,
  className = "",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: string;
  iconColor?: string;
  valueColor?: string;
  href?: string;
  className?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-[var(--color-text-secondary)]">
          {label}
        </span>
        {icon ? (
          <span
            aria-hidden="true"
            className="material-symbols-rounded text-[20px]"
            style={{ color: iconColor }}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div
        className="mt-2 font-archivo text-[30px] font-extrabold leading-none"
        style={{ color: valueColor }}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-[7px] text-[12.5px] text-[var(--color-text-secondary)]">
          {sub}
        </div>
      ) : null}
    </>
  );
  const cls = `block rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-[18px] text-left shadow-[0_1px_2px_rgba(17,24,39,0.04)] ${className}`;
  if (href) {
    return (
      <Link
        href={href}
        className={`${cls} transition-colors hover:border-[#BFDBFE] hover:bg-[#FBFDFF]`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "warn";
  children: ReactNode;
}) {
  // Info stays blue (links/info banners are deliberately not green).
  const tones = {
    info: "bg-[var(--color-info-bg)] text-[#1E40AF] border-[#BFDBFE]",
    success:
      "bg-[var(--color-success-bg)] text-[var(--color-ok)] border-[var(--color-success-border)]",
    warn: "bg-[var(--color-warning-bg)] text-[var(--color-warn)] border-amber-200",
  } as const;
  return (
    <div
      role="status"
      className={`flex items-center gap-2.5 rounded-[11px] border px-[15px] py-[11px] text-[12.5px] font-medium ${tones[tone]}`}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

/**
 * Status badge — consistent across leave, certs, timesheets, stock,
 * notifications, roster status, etc. Archivo 700, small, uppercase, bordered.
 * Palettes come straight from the design's BADGE map.
 */
const badgeTones = {
  success: "text-[#15803D] bg-[#ECFDF3] border-[#BBF7D0]",
  warning: "text-[#B45309] bg-[#FEF3E2] border-[#FED7AA]",
  danger: "text-[#B91C1C] bg-[#FEECEC] border-[#FECACA]",
  info: "text-[#1D4ED8] bg-[#EFF6FF] border-[#BFDBFE]",
  draft: "text-[#6B7280] bg-[#F3F4F6] border-[#E5E7EB]",
  ok: "text-[#5A7D17] bg-[#F0F6E2] border-[#D6E8B0]",
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
      className={`font-archivo inline-flex items-center rounded-[6px] border px-[9px] py-[3px] text-[10px] font-bold uppercase leading-none tracking-[0.04em] ${badgeTones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

/** Bottom-right dark toast pill (write-action confirmations). */
export function Toast({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="fixed bottom-[26px] right-[26px] z-[300] flex max-w-[360px] items-center gap-2.5 rounded-[12px] bg-[var(--color-ink)] px-[18px] py-[14px] text-[13.5px] font-medium text-white shadow-[0_16px_40px_rgba(0,0,0,0.28)] [animation:rosterToast_0.26s_ease]"
    >
      <span className="material-symbols-rounded text-[21px] text-[var(--color-accent)]">
        check_circle
      </span>
      <span>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  children,
  className = "",
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`px-6 py-12 text-center ${className}`}>
      {icon ? (
        <span
          aria-hidden="true"
          className="material-symbols-rounded mb-2 text-[34px] text-[var(--color-text-muted)]"
        >
          {icon}
        </span>
      ) : null}
      <p className="font-archivo text-[15px] font-bold text-[var(--color-text)]">
        {title}
      </p>
      {children ? (
        <div className="mx-auto mt-1 max-w-md text-[13px] text-[var(--color-text-secondary)]">
          {children}
        </div>
      ) : null}
    </div>
  );
}
