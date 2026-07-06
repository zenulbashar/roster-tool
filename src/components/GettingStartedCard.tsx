import Link from "next/link";
import { Card } from "@/components/ui";
import type { GettingStarted, GettingStartedStep } from "@/lib/getting-started";

/**
 * The owner dashboard "Get set up" checklist. Purely presentational — step
 * state is derived from existing data (see `buildGettingStarted`) and the
 * caller only renders this while `showChecklist` is true.
 */

function StepRow({ step }: { step: GettingStartedStep }) {
  if (step.done) {
    return (
      <div className="flex items-center gap-[13px] rounded-[10px] px-3 py-[13px]">
        <span
          aria-hidden="true"
          className="material-symbols-rounded fill text-[24px] text-[#16A34A]"
        >
          check_circle
        </span>
        <span className="flex-1 text-[14.5px] text-[#9CA3AF] line-through">
          {step.title}
          <span className="sr-only"> — done</span>
        </span>
        <span className="rounded-[6px] bg-[#ECFDF3] px-[9px] py-[3px] text-[11.5px] font-bold text-[#16A34A]">
          DONE
        </span>
      </div>
    );
  }
  return (
    <Link
      href={step.href}
      className="flex items-center gap-[13px] rounded-[10px] px-3 py-[13px] hover:bg-[#F9FAFB]"
    >
      <span
        aria-hidden="true"
        className="material-symbols-rounded text-[24px] text-[#D1D5DB]"
      >
        radio_button_unchecked
      </span>
      <span className="flex-1 text-[14.5px] font-medium text-[var(--color-text)]">
        {step.title}
      </span>
      <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#4D7C0F]">
        Start
        <span
          aria-hidden="true"
          className="material-symbols-rounded text-[18px]"
        >
          arrow_forward
        </span>
      </span>
    </Link>
  );
}

function OptionalStep({ step }: { step: GettingStartedStep }) {
  return (
    <Link
      href={step.href}
      className="inline-flex items-center gap-2 text-[13.5px] text-[var(--color-text-muted)] hover:underline"
    >
      <span
        aria-hidden="true"
        className={`material-symbols-rounded text-[20px] ${
          step.done ? "fill text-[#16A34A]" : "text-[#CBD5E1]"
        }`}
      >
        {step.done ? "check_circle" : "radio_button_unchecked"}
      </span>
      {step.title}
    </Link>
  );
}

export function GettingStartedCard({ data }: { data: GettingStarted }) {
  const pct =
    data.coreTotal > 0
      ? Math.round((data.coreDoneCount / data.coreTotal) * 100)
      : 0;
  return (
    <Card padded={false} className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-[22px] py-[18px]">
        <div>
          <h2 className="font-archivo text-[16px] font-bold text-[var(--color-text)]">
            Get set up
          </h2>
          <p className="mt-0.5 text-[12.5px] text-[var(--color-text-secondary)]">
            {data.coreDoneCount} of {data.coreTotal} core steps done
          </p>
        </div>
        <div className="flex items-center gap-[11px]">
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

      <div className="px-[10px] py-1.5">
        {data.coreSteps.map((s) => (
          <StepRow key={s.key} step={s} />
        ))}
      </div>

      <div className="border-t border-[var(--color-border-subtle)] bg-[#FAFBFC] px-[22px] py-[14px]">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-[#9CA3AF]">
          Optional — set up later
        </p>
        <div className="flex flex-wrap gap-x-[22px] gap-y-2">
          {data.optionalSteps.map((s) => (
            <OptionalStep key={s.key} step={s} />
          ))}
        </div>
      </div>
    </Card>
  );
}
