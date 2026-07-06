/**
 * Light brand header for the staff-facing phone pages (/me notices, /r public
 * roster, /a availability). A small ROSTER wordmark + the venue name, then the
 * page title and subtitle. No links into /app — these pages are staff-only.
 */
export function StaffHeader({
  businessName,
  title,
  subtitle,
  eyebrow,
}: {
  businessName: string;
  title: string;
  subtitle?: string;
  eyebrow?: string;
}) {
  return (
    <header className="mb-5">
      <div className="mb-3 flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-[var(--color-ink)]"
        >
          <span className="material-symbols-rounded text-[17px] text-[var(--color-accent)]">
            grid_view
          </span>
        </span>
        <span className="font-archivo text-[15px] font-extrabold tracking-[0.05em] text-[var(--color-ink)]">
          ROSTER
        </span>
        <span className="border-l border-[var(--color-border)] pl-2.5 text-[12.5px] text-[var(--color-text-secondary)]">
          {businessName}
        </span>
      </div>
      {eyebrow ? (
        <div className="font-archivo text-[11px] font-bold uppercase tracking-[0.08em] text-[#76b900]">
          {eyebrow}
        </div>
      ) : null}
      <h1 className="font-archivo text-[24px] font-extrabold tracking-[-0.015em] text-[var(--color-ink)]">
        {title}
      </h1>
      {subtitle ? (
        <p className="mt-1.5 text-[14px] leading-[1.5] text-[var(--color-text-secondary)]">
          {subtitle}
        </p>
      ) : null}
    </header>
  );
}
