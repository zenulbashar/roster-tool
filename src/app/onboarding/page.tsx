import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { businesses, users } from "@/lib/db/schema";
import { Button, Card, Field, TextInput } from "@/components/ui";

const AU_TIMEZONES = [
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Perth",
  "Australia/Hobart",
  "Australia/Darwin",
];

const onboardingSchema = z.object({
  name: z.string().trim().min(1, "Please enter your business name").max(120),
  timezone: z.enum(AU_TIMEZONES as [string, ...string[]]),
});

export default async function OnboardingPage() {
  const session = await requireSession();
  if (session.user.businessId) redirect("/app");

  async function createBusiness(formData: FormData) {
    "use server";
    const current = await requireSession();
    if (current.user.businessId) redirect("/app");

    const parsed = onboardingSchema.safeParse({
      name: formData.get("name"),
      timezone: formData.get("timezone"),
    });
    if (!parsed.success) {
      // Minimal MVP error handling: bounce back to the form.
      redirect("/onboarding?error=1");
    }

    const [business] = await db
      .insert(businesses)
      .values({ name: parsed.data.name, timezone: parsed.data.timezone })
      .returning();

    await db
      .update(users)
      .set({ businessId: business!.id })
      .where(eq(users.id, current.user.id));

    redirect("/app");
  }

  return (
    <main id="main" className="mx-auto max-w-md px-5 py-16">
      <h1 className="text-2xl font-bold tracking-tight">
        Set up your business
      </h1>
      <p className="mt-2 text-[var(--color-muted)]">
        Just one quick step before you start building rosters.
      </p>
      <Card className="mt-6">
        <form action={createBusiness} className="space-y-4">
          <Field label="Business name">
            <TextInput
              name="name"
              required
              maxLength={120}
              placeholder="e.g. Brew & Bite Café"
              autoFocus
            />
          </Field>
          <Field label="Time zone" hint="Used to show dates and times.">
            <select
              name="timezone"
              defaultValue="Australia/Sydney"
              className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-base"
            >
              {AU_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace("Australia/", "")}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" className="w-full">
            Create business
          </Button>
        </form>
      </Card>
    </main>
  );
}
