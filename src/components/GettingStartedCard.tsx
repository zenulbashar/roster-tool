import Link from "next/link";
import { Card } from "@/components/ui";
import type { GettingStarted, GettingStartedStep } from "@/lib/getting-started";

/**
 * The owner dashboard "Getting started" checklist. Purely presentational —
 * step state is derived from existing data (see `buildGettingStarted`) and
 * the caller only renders this while `showChecklist` is true.
 */

function StepRow({
  step,
  optional = false,
}: {
  step: GettingStartedStep;
  optional?: boolean;
}) {
  if (step.done) {
    return (
      <div className="flex items-center gap-[13px] rounded-[10px] px-3 py-3">
        <span
          aria-hidden="true"
          className="material-symbols-rounded fill text-[24px] text-[var(--color-success)]"
        >
          check_circle
        </span>
        <span className="flex-1 text-[14.5px] text-[var(--color-text-muted)] line-through">
          {step.title}
          <span className="sr-only"> — done</span>
        </span>
        <span className="font-archivo rounded-[var(--radius-sm)] bg-[var(--color-success-bg)] px-[9px] py-[3px] text-[11.5px] font-bold text-[var(--color-success)]">
          Done
        </span>
      </div>
    );
  }
  return (
    <Link
      href={step.href}
      className="flex items-center gap-[13px] rounded-[10px] px-3 py-3 hover:bg-[var(--color-bg)]"
    >
      <span
        aria-hidden="true"
        className="material-symbols-rounded text-[24px] text-[#D1D5DB]"
      >
        radio_button_unchecked
      </span>
      <span className="flex-1">
        <span className="block text-[14.5px] font-medium text-[var(--color-text)]">
          {step.title}
        </span>
        {!optional ? (
          <span className="block text-[13px] text-[var(--color-text-secondary)]">
            {step.description}
          </span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className="material-symbols-rounded text-[18px] text-[#4D7C0F]"
      >
        arrow_forward
      </span>
    </Link>
  );
}

export function GettingStartedCard({ data }: { data: GettingStarted }) {
  const pct =
    data.coreTotal > 0
      ? Math.round((data.coreDoneCount / data.coreTotal) * 100)
      : 0;
  return (
    <Card className="mb-6 overflow-hidden !p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-[22px] py-[18px]">
        <div>
          <h2 className="font-archivo text-[16px] font-bold text-[var(--color-text)]">
            Getting started
          </h2>
          <p className="mt-0.5 text-[12.5px] text-[var(--color-text-secondary)]">
            {data.coreDoneCount} of {data.coreTotal} core steps done
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="h-2 w-[120px] overflow-hidden rounded-[6px] bg-[#F3F4F6]"
          >
            <span
              className="block h-full rounded-[6px] bg-[var(--color-accent)]"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="font-archivo text-[13px] font-bold text-[#3F6212]">
            {pct}%
          </span>
        </div>
      </div>

      <div className="p-3">
        {data.coreSteps.map((s) => (
          <StepRow key={s.key} step={s} />
        ))}
      </div>

      <div className="border-t border-[var(--color-border-subtle)] bg-[#FAFBFC] px-[22px] py-[14px]">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Optional — only if you order stock
        </p>
        <div className="mt-1 flex flex-wrap gap-x-2">
          {data.optionalSteps.map((s) => (
            <StepRow key={s.key} step={s} optional />
          ))}
        </div>
      </div>
    </Card>
  );
}
