import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { createFormSchema } from "@/lib/validation";
import { formatDate, DEFAULT_TIMEZONE } from "@/lib/time";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Field,
  PageHeader,
  TextInput,
} from "@/components/ui";

const PATH = "/app/forms";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  closed: "Closed",
};

export default async function FormsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; deleted?: string }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const [business, forms] = await Promise.all([
    repo.getBusiness(),
    repo.listForms(),
  ]);
  const tz = business?.timezone ?? DEFAULT_TIMEZONE;

  async function createForm(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const parsed = createFormSchema.safeParse({ title: formData.get("title") });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Please enter a title";
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
    }
    const form = await repo.createForm({ title: parsed.data.title });
    revalidatePath(PATH);
    redirect(`${PATH}/${form.id}`);
  }

  async function deleteForm(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    await repo.deleteForm(String(formData.get("id")));
    revalidatePath(PATH);
    redirect(`${PATH}?deleted=1`);
  }

  return (
    <>
      <PageHeader
        title="Forms"
        subtitle="Build your own forms — pick the questions and the answer types. Saved as drafts; publishing comes later."
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.deleted ? <Banner tone="success">Form deleted.</Banner> : null}

      <section className="mt-4" aria-label="Forms">
        <h2 className="mb-3 text-lg font-semibold">
          Your forms ({forms.length})
        </h2>
        {forms.length === 0 ? (
          <p className="text-[var(--color-muted)]">
            None yet. Create your first form below.
          </p>
        ) : (
          <ul className="space-y-2">
            {forms.map((f) => (
              <li key={f.id}>
                <Card className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{f.title}</p>
                      <p className="text-sm text-[var(--color-muted)]">
                        <span className="inline-block rounded-full border border-[var(--color-line)] px-2 py-0.5 text-xs font-semibold">
                          {STATUS_LABEL[f.status] ?? f.status}
                        </span>
                        {" · "}
                        {f.fieldCount} field{f.fieldCount === 1 ? "" : "s"}
                        {" · created "}
                        {formatDate(f.createdAt, tz)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <ButtonLink href={`${PATH}/${f.id}`} variant="secondary">
                        Edit
                      </ButtonLink>
                      <form action={deleteForm}>
                        <input type="hidden" name="id" value={f.id} />
                        <Button type="submit" variant="danger">
                          Delete
                        </Button>
                      </form>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card className="mt-8">
        <h2 className="text-lg font-semibold">New form</h2>
        <form action={createForm} className="mt-3 space-y-3">
          <Field label="Title">
            <TextInput
              name="title"
              required
              maxLength={200}
              placeholder="e.g. Staff feedback"
            />
          </Field>
          <Button type="submit">Create form</Button>
        </form>
      </Card>
    </>
  );
}
