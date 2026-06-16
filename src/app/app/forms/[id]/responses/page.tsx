import Link from "next/link";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { env } from "@/lib/env";
import { formatDateTime, DEFAULT_TIMEZONE } from "@/lib/time";
import {
  buildFormSummary,
  buildResponseDetail,
  type LiveField,
  type FieldSummary,
} from "@/lib/form-report";
import { EXPORT_CAP } from "@/lib/form-export";
import { ButtonLink, Card, PageHeader } from "@/components/ui";

const PATH = "/app/forms";
const PAGE_SIZE = 25;

function val(v: string | number | null): string {
  return v === null || v === "" ? "—" : String(v);
}

function SummaryCard({ s }: { s: FieldSummary }) {
  return (
    <Card className="py-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">
          {s.label}
          {s.deleted ? (
            <span className="ml-2 text-xs font-normal text-[var(--color-muted)]">
              (removed field)
            </span>
          ) : null}
        </h3>
        <span className="text-sm text-[var(--color-muted)]">
          {s.kind === "text"
            ? `${s.recent.length} shown`
            : `${s.count} answered`}
        </span>
      </div>

      {s.kind === "rating" ? (
        s.count === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            No ratings yet.
          </p>
        ) : (
          <div className="mt-2">
            <p className="text-sm">
              Average{" "}
              <span className="font-semibold">{s.average?.toFixed(2)}</span> / 5
              <span className="text-[var(--color-muted)]">
                {" "}
                ({s.count} rating{s.count === 1 ? "" : "s"})
              </span>
            </p>
            <div className="mt-2 space-y-1">
              {[...s.distribution].reverse().map((d) => {
                const max = Math.max(...s.distribution.map((x) => x.count), 1);
                return (
                  <div
                    key={d.value}
                    className="flex items-center gap-2 text-sm"
                  >
                    <span className="w-6 tabular-nums">{d.value}★</span>
                    <span
                      className="inline-block h-3 rounded bg-[var(--color-accent)]"
                      style={{ width: `${(d.count / max) * 100}%` }}
                      aria-hidden="true"
                    />
                    <span className="tabular-nums text-[var(--color-muted)]">
                      {d.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )
      ) : null}

      {s.kind === "tally" ? (
        s.count === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            No answers yet.
          </p>
        ) : (
          <div className="mt-2 space-y-1">
            {s.tally.map((t) => {
              const max = Math.max(...s.tally.map((x) => x.count), 1);
              return (
                <div key={t.value} className="flex items-center gap-2 text-sm">
                  <span className="w-28 truncate">{val(t.value)}</span>
                  <span
                    className="inline-block h-3 rounded bg-[var(--color-accent)]"
                    style={{ width: `${(t.count / max) * 100}%` }}
                    aria-hidden="true"
                  />
                  <span className="tabular-nums text-[var(--color-muted)]">
                    {t.count}
                  </span>
                </div>
              );
            })}
          </div>
        )
      ) : null}

      {s.kind === "text" ? (
        s.recent.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            No answers yet.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {s.recent.map((t, i) => (
              <li
                key={i}
                className="rounded border border-[var(--color-line)] px-2 py-1"
              >
                {t}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Card>
  );
}

export default async function FormResponsesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const repo = await ownerRepo();

  const data = await repo.getFormWithFields(id);
  if (!data) {
    redirect(
      `${PATH}?error=${encodeURIComponent("That form could not be found.")}`,
    );
  }

  const business = await repo.getBusiness();
  const tz = business?.timezone ?? DEFAULT_TIMEZONE;

  const liveFields: LiveField[] = data.fields.map((f) => ({
    id: f.id,
    label: f.label,
    type: f.type,
    position: f.position,
  }));

  const total = await repo.countResponses(id);
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [aggregates, recentText, responses] = await Promise.all([
    repo.getResponseSummaryAggregates(id),
    repo.getRecentTextAnswers(id, 5),
    repo.getResponsesForForm(id, { limit: PAGE_SIZE, offset }),
  ]);
  const summaries = buildFormSummary(liveFields, aggregates, recentText);

  const publicUrl =
    data.form.publicSlug !== null
      ? `${env.APP_URL}/f/${data.form.publicSlug}`
      : null;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title={`Responses — ${data.form.title}`}
        subtitle={`${total} response${total === 1 ? "" : "s"} collected.`}
      />
      <Link
        href={`${PATH}/${id}`}
        className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
      >
        ← Back to form
      </Link>

      {total === 0 ? (
        <Card className="mt-6">
          <p className="font-semibold">No responses yet</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {publicUrl
              ? "Share the form's link or QR code to start collecting responses."
              : "Publish the form to start collecting responses."}
          </p>
          {publicUrl ? (
            <code className="mt-3 inline-block break-all rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 text-sm">
              {publicUrl}
            </code>
          ) : null}
        </Card>
      ) : (
        <>
          <section className="mt-6" aria-label="Summary">
            <h2 className="mb-3 text-lg font-semibold">Summary</h2>
            {summaries.length === 0 ? (
              <p className="text-[var(--color-muted)]">
                This form has no fields.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {summaries.map((s) => (
                  <SummaryCard key={s.key} s={s} />
                ))}
              </div>
            )}
          </section>

          <section className="mt-8" aria-label="Responses">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">All responses ({total})</h2>
              <div className="flex flex-col items-end">
                <ButtonLink
                  href={`${PATH}/${id}/responses/export`}
                  variant="secondary"
                >
                  Export CSV
                </ButtonLink>
                {total > EXPORT_CAP ? (
                  <span className="mt-1 text-xs text-[var(--color-muted)]">
                    Exports the newest {EXPORT_CAP.toLocaleString()}.
                  </span>
                ) : null}
              </div>
            </div>
            <ul className="space-y-2">
              {responses.map((r) => {
                const detail = buildResponseDetail(liveFields, r.answers);
                const preview = detail
                  .slice(0, 2)
                  .map((d) => val(d.value))
                  .join(" · ");
                return (
                  <li key={r.id}>
                    <Card className="py-3">
                      <details>
                        <summary className="cursor-pointer">
                          <span className="font-medium">
                            {formatDateTime(r.submittedAt, tz)}
                          </span>
                          <span className="text-sm text-[var(--color-muted)]">
                            {" · "}
                            {r.channel}
                            {r.source ? ` · ${r.source}` : ""}
                            {preview ? ` — ${preview}` : ""}
                          </span>
                        </summary>
                        <dl className="mt-3 space-y-2">
                          {detail.map((d, i) => (
                            <div key={i}>
                              <dt className="text-sm font-semibold">
                                {d.label}
                                {d.deleted ? (
                                  <span className="ml-1 text-xs font-normal text-[var(--color-muted)]">
                                    (removed field)
                                  </span>
                                ) : null}
                              </dt>
                              <dd className="text-sm">{val(d.value)}</dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    </Card>
                  </li>
                );
              })}
            </ul>

            {lastPage > 1 ? (
              <nav
                className="mt-4 flex items-center justify-between"
                aria-label="Pagination"
              >
                {page > 1 ? (
                  <Link
                    href={`${PATH}/${id}/responses?page=${page - 1}`}
                    className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                  >
                    ← Newer
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-sm text-[var(--color-muted)]">
                  Page {page} of {lastPage}
                </span>
                {page < lastPage ? (
                  <Link
                    href={`${PATH}/${id}/responses?page=${page + 1}`}
                    className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                  >
                    Older →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </section>
        </>
      )}
    </>
  );
}
