import Link from "next/link";
import { Card } from "@/components/ui";
import type { GettingStarted, GettingStartedStep } from "@/lib/getting-started";

/**
 * The owner dashboard "Getting started" checklist. Purely presentational —
 * step state is derived from existing data (see `buildGettingStarted`) and
 * the caller only renders this while `showChecklist` is true.
 */

function StepRow({ step }: { step: GettingStartedStep }) {
  return (
    <li className="flex items-start gap-3 py-2">
      {step.done ? (
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-ok)] text-sm font-bold text-white"
        >
          ✓
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="mt-0.5 h-6 w-6 shrink-0 rounded-full border-2 border-[var(--color-line)]"
        />
      )}
      <div>
        {step.done ? (
          <>
            <p className="font-semibold text-[var(--color-muted)] line-through">
              {step.title}
              <span className="sr-only"> — done</span>
            </p>
            <p className="text-sm text-[var(--color-muted)]">
              {step.description}
            </p>
          </>
        ) : (
          <>
            <Link
              href={step.href}
              className="font-semibold text-[var(--color-brand)] underline underline-offset-2"
            >
              {step.title}
            </Link>
            <p className="text-sm text-[var(--color-muted)]">
              {step.description}
            </p>
          </>
        )}
      </div>
    </li>
  );
}

export function GettingStartedCard({ data }: { data: GettingStarted }) {
  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Getting started</h2>
        <p className="text-sm font-medium text-[var(--color-muted)]">
          {data.coreDoneCount} of {data.coreTotal} done
        </p>
      </div>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Welcome! A few quick steps and your roster is up and running. This list
        ticks itself off as you go, and disappears when you’re set up.
      </p>
      <ul className="mt-3 divide-y divide-[var(--color-line)]">
        {data.coreSteps.map((s) => (
          <StepRow key={s.key} step={s} />
        ))}
      </ul>
      <h3 className="mt-4 text-sm font-semibold text-[var(--color-muted)]">
        Optional — only if you order stock
      </h3>
      <ul className="divide-y divide-[var(--color-line)]">
        {data.optionalSteps.map((s) => (
          <StepRow key={s.key} step={s} />
        ))}
      </ul>
    </Card>
  );
}
