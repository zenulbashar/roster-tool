import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { periodSchema } from "@/lib/validation";
import { expandTemplatesToShifts } from "@/lib/roster";
import { formatDateOnly } from "@/lib/time";
import {
  Badge,
  type BadgeTone,
  Banner,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  Icon,
  PageHeader,
  TextInput,
} from "@/components/ui";

const PATH = "/app/periods";

const STATUS_BADGE: Record<string, { tone: BadgeTone; label: string }> = {
  collecting: { tone: "warning", label: "Collecting availability" },
  building: { tone: "info", label: "Building roster" },
  draft: { tone: "draft", label: "Draft" },
  published: { tone: "success", label: "Published" },
};

export default async function PeriodsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const periods = await repo.listPeriods();

  async function createPeriod(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const parsed = periodSchema.safeParse({
      label: formData.get("label"),
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate"),
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Please check the form";
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
    }

    const period = await repo.createPeriod(parsed.data);

    // Expand the business's active shift types into concrete shifts.
    const templates = await repo.listTemplates({ activeOnly: true });
    const rows = expandTemplatesToShifts(parsed.data, templates).map((r) => ({
      ...r,
      rosterPeriodId: period.id,
    }));
    await repo.createShifts(rows);

    revalidatePath(PATH);
    redirect(`${PATH}/${period.id}`);
  }

  return (
    <>
      <PageHeader
        title="Roster periods"
        subtitle="Each week is a period — collect availability, build, then publish to your team."
        action={
          <ButtonLink href="#new-roster">
            <Icon name="add" className="text-[19px]" />
            New roster period
          </ButtonLink>
        }
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}

      <Card padded={false}>
        {periods.length === 0 ? (
          <EmptyState icon="calendar_month" title="No roster periods yet">
            Start your first roster below to collect availability and build the
            week.
          </EmptyState>
        ) : (
          <>
            {periods.map((p) => {
              const status = STATUS_BADGE[p.status] ?? {
                tone: "draft" as BadgeTone,
                label: p.status,
              };
              const published = p.status === "published";
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-4 border-b border-[var(--color-border-subtle)] px-5 py-4"
                >
                  <div
                    aria-hidden="true"
                    className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[11px] bg-[#F4F8E9]"
                  >
                    <Icon
                      name="calendar_month"
                      className="text-[22px] text-[#5A7D17]"
                    />
                  </div>
                  <div className="min-w-[150px]">
                    <div className="font-archivo text-[15.5px] font-bold text-[var(--color-text)]">
                      {formatDateOnly(p.startDate)} –{" "}
                      {formatDateOnly(p.endDate)}
                    </div>
                    <div className="mt-0.5 text-[12px] text-[#9CA3AF]">
                      {p.label}
                    </div>
                  </div>
                  <div className="flex flex-1 flex-wrap items-center gap-3.5">
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <ButtonLink
                    href={`${PATH}/${p.id}`}
                    variant={published ? "secondary" : "primary"}
                  >
                    {published ? (
                      "View"
                    ) : (
                      <>
                        Build
                        <Icon name="arrow_forward" className="text-[17px]" />
                      </>
                    )}
                  </ButtonLink>
                </div>
              );
            })}
            <div className="flex items-center gap-1.5 bg-[#FAFBFC] px-5 py-3.5 text-[12.5px] text-[#9CA3AF]">
              <Icon name="history" className="text-[17px]" />
              Older periods stay in the list — this covers every week
              you&rsquo;ve created.
            </div>
          </>
        )}
      </Card>

      <section id="new-roster" className="mt-6 scroll-mt-24">
        <Card>
          <h2 className="font-archivo text-[16px] font-bold text-[var(--color-text)]">
            Start a new roster
          </h2>
          <p className="mt-1 text-[13px] text-[#6B7280]">
            We&rsquo;ll fill it with your shift types for each day.
          </p>
          <form action={createPeriod} className="mt-4 space-y-4">
            <Field label="Name">
              <TextInput name="label" required placeholder="e.g. Next week" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="First day">
                <TextInput type="date" name="startDate" required />
              </Field>
              <Field label="Last day">
                <TextInput type="date" name="endDate" required />
              </Field>
            </div>
            <Button type="submit">Create roster</Button>
          </form>
        </Card>
      </section>
    </>
  );
}
