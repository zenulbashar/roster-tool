import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { staffSchema } from "@/lib/validation";
import {
  Banner,
  Button,
  Card,
  Field,
  PageHeader,
  TextInput,
} from "@/components/ui";

const PATH = "/app/staff";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; added?: string }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const staff = await repo.listStaff();

  async function addStaff(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const parsed = staffSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Please check the form";
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
    }
    try {
      await repo.addStaff(parsed.data);
    } catch (err) {
      if (isUniqueViolation(err)) {
        redirect(
          `${PATH}?error=${encodeURIComponent("That email is already on your team")}`,
        );
      }
      throw err;
    }
    revalidatePath(PATH);
    redirect(`${PATH}?added=1`);
  }

  async function toggleActive(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const active = formData.get("active") === "true";
    await repo.updateStaff(id, { active: !active });
    revalidatePath(PATH);
  }

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="The people who work for you. We'll email them when you ask for availability."
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.added ? <Banner tone="success">Staff member added.</Banner> : null}

      <Card className="mt-4">
        <h2 className="text-lg font-semibold">Add someone</h2>
        <form action={addStaff} className="mt-3 space-y-4">
          <Field label="Name">
            <TextInput name="name" required placeholder="e.g. Ava Nguyen" />
          </Field>
          <Field label="Email">
            <TextInput
              type="email"
              name="email"
              required
              placeholder="ava@example.com"
            />
          </Field>
          <Button type="submit">Add to team</Button>
        </form>
      </Card>

      <section className="mt-8" aria-label="Your team">
        <h2 className="mb-3 text-lg font-semibold">
          Your team ({staff.filter((s) => s.active).length})
        </h2>
        {staff.length === 0 ? (
          <p className="text-[var(--color-muted)]">
            No one yet. Add your first team member above.
          </p>
        ) : (
          <ul className="space-y-2">
            {staff.map((s) => (
              <li key={s.id}>
                <Card className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-semibold">
                      {s.name}
                      {!s.active ? (
                        <span className="ml-2 rounded bg-[var(--color-canvas)] px-2 py-0.5 text-xs font-medium text-[var(--color-muted)]">
                          Inactive
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-[var(--color-muted)]">
                      {s.email}
                    </p>
                  </div>
                  <form action={toggleActive}>
                    <input type="hidden" name="id" value={s.id} />
                    <input
                      type="hidden"
                      name="active"
                      value={String(s.active)}
                    />
                    <button
                      type="submit"
                      className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                    >
                      {s.active ? "Remove" : "Add back"}
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
