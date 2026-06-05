import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { periodSchema } from "@/lib/validation";
import { expandTemplatesToShifts } from "@/lib/roster";
import { formatDateOnly } from "@/lib/time";
import { periodStatusLabel } from "@/lib/labels";
import {
  Banner,
  Button,
  Card,
  Field,
  PageHeader,
  TextInput,
} from "@/components/ui";

const PATH = "/app/periods";

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
        title="Rosters"
        subtitle="Each roster covers a stretch of days, like next week."
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}

      <Card className="mt-4">
        <h2 className="text-lg font-semibold">Start a new roster</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          We&rsquo;ll fill it with your shift types for each day.
        </p>
        <form action={createPeriod} className="mt-3 space-y-4">
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

      <section className="mt-8" aria-label="Your rosters">
        <h2 className="mb-3 text-lg font-semibold">Your rosters</h2>
        {periods.length === 0 ? (
          <p className="text-[var(--color-muted)]">
            No rosters yet. Start one above.
          </p>
        ) : (
          <ul className="space-y-2">
            {periods.map((p) => (
              <li key={p.id}>
                <Link href={`${PATH}/${p.id}`} className="block">
                  <Card className="flex items-center justify-between gap-4 py-3 transition hover:border-[var(--color-brand)]">
                    <div>
                      <p className="font-semibold">{p.label}</p>
                      <p className="text-sm text-[var(--color-muted)]">
                        {formatDateOnly(p.startDate)} –{" "}
                        {formatDateOnly(p.endDate)}
                      </p>
                    </div>
                    <span className="rounded-full bg-[var(--color-canvas)] px-3 py-1 text-xs font-medium text-[var(--color-muted)]">
                      {periodStatusLabel(p.status)}
                    </span>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
