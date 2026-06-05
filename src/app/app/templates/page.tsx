import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { templateSchema } from "@/lib/validation";
import { formatTimeOnly } from "@/lib/time";
import {
  Banner,
  Button,
  Card,
  Field,
  PageHeader,
  TextInput,
} from "@/components/ui";

const PATH = "/app/templates";

const WEEKDAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 7, label: "Sun" },
];

function summariseDays(weekdays: number[]): string {
  if (weekdays.length === 7) return "Every day";
  return WEEKDAYS.filter((d) => weekdays.includes(d.n))
    .map((d) => d.label)
    .join(", ");
}

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; added?: string }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const templates = await repo.listTemplates();

  async function addTemplate(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const weekdays = formData.getAll("weekdays").map((v) => Number(v));
    const parsed = templateSchema.safeParse({
      label: formData.get("label"),
      startTime: formData.get("startTime"),
      endTime: formData.get("endTime"),
      weekdays,
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Please check the form";
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
    }
    await repo.addTemplate(parsed.data);
    revalidatePath(PATH);
    redirect(`${PATH}?added=1`);
  }

  async function toggleActive(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const active = formData.get("active") === "true";
    await repo.updateTemplate(id, { active: !active });
    revalidatePath(PATH);
  }

  return (
    <>
      <PageHeader
        title="Shift types"
        subtitle="The shifts you run each day, like Morning or Evening. You'll reuse these every week."
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.added ? <Banner tone="success">Shift type added.</Banner> : null}

      <Card className="mt-4">
        <h2 className="text-lg font-semibold">Add a shift type</h2>
        <form action={addTemplate} className="mt-3 space-y-4">
          <Field label="Name">
            <TextInput name="label" required placeholder="e.g. Morning" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Starts">
              <TextInput
                type="time"
                name="startTime"
                required
                defaultValue="09:00"
              />
            </Field>
            <Field label="Ends">
              <TextInput
                type="time"
                name="endTime"
                required
                defaultValue="17:00"
              />
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1 block text-sm font-semibold">
              Which days?
            </legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => (
                <label
                  key={d.n}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm has-[:checked]:border-[var(--color-brand)] has-[:checked]:bg-blue-50"
                >
                  <input
                    type="checkbox"
                    name="weekdays"
                    value={d.n}
                    defaultChecked
                    className="h-4 w-4"
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit">Add shift type</Button>
        </form>
      </Card>

      <section className="mt-8" aria-label="Your shift types">
        <h2 className="mb-3 text-lg font-semibold">Your shift types</h2>
        {templates.length === 0 ? (
          <p className="text-[var(--color-muted)]">
            None yet. Add the shifts you run above.
          </p>
        ) : (
          <ul className="space-y-2">
            {templates.map((t) => (
              <li key={t.id}>
                <Card className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-semibold">
                      {t.label}
                      {!t.active ? (
                        <span className="ml-2 rounded bg-[var(--color-canvas)] px-2 py-0.5 text-xs font-medium text-[var(--color-muted)]">
                          Off
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-[var(--color-muted)]">
                      {formatTimeOnly(t.startTime)} –{" "}
                      {formatTimeOnly(t.endTime)} · {summariseDays(t.weekdays)}
                    </p>
                  </div>
                  <form action={toggleActive}>
                    <input type="hidden" name="id" value={t.id} />
                    <input
                      type="hidden"
                      name="active"
                      value={String(t.active)}
                    />
                    <button
                      type="submit"
                      className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                    >
                      {t.active ? "Turn off" : "Turn on"}
                    </button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
