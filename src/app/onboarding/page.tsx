import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { signOut } from "@/lib/auth";
import { requireSession } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { businesses, users } from "@/lib/db/schema";
import { AccountIdentity } from "@/components/AccountIdentity";

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

  // For someone who signed in with the wrong address, the next step is
  // requesting a fresh link — so this lands on the sign-in form (the header's
  // sign-out elsewhere keeps going to "/").
  async function signOutToSignIn() {
    "use server";
    await signOut({ redirectTo: "/sign-in" });
  }

  return (
    <main
      id="main"
      className="flex min-h-screen items-center justify-center px-5 py-10"
      style={{
        backgroundImage:
          "radial-gradient(circle at 50% 0, #F4F8E9, #F9FAFB 60%)",
      }}
    >
      <div className="w-full max-w-[460px]">
        <Link
          href="/"
          className="mb-[22px] flex items-center justify-center gap-2.5"
        >
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#111827]"
          >
            <span className="material-symbols-rounded text-[20px] text-[#76b900]">
              grid_view
            </span>
          </span>
          <span className="font-archivo text-[22px] font-extrabold tracking-[0.05em] text-[#111827]">
            ROSTER
          </span>
        </Link>

        <div className="overflow-hidden rounded-[18px] border border-[#E5E7EB] bg-white shadow-[0_8px_30px_rgba(17,24,39,0.07)]">
          <div className="border-b border-[#F1F3F5] bg-[#FAFBFC] px-[18px] py-3">
            <AccountIdentity
              email={session.user.email ?? null}
              lead="You're signed in as"
              hint="Used Roster before? You may have signed in with a different address."
            >
              <form action={signOutToSignIn}>
                <button
                  type="submit"
                  className="whitespace-nowrap text-[12.5px] font-semibold text-[#4D7C0F] hover:underline"
                >
                  Sign out
                </button>
              </form>
            </AccountIdentity>
          </div>

          <div className="p-[30px]">
            <div className="font-archivo text-[11.5px] font-bold uppercase tracking-[0.08em] text-[#76b900]">
              Step 1 of 1 — almost there
            </div>
            <h1 className="mt-2.5 font-archivo text-[25px] font-extrabold tracking-[-0.01em] text-[#111827]">
              Let&rsquo;s set up your business.
            </h1>
            <p className="mb-[22px] mt-1.5 text-[14px] leading-[1.5] text-[#6B7280]">
              Just a name to start. You can add staff, shifts and suppliers
              next.
            </p>

            <form action={createBusiness}>
              <label
                htmlFor="business-name"
                className="mb-[7px] block text-[12.5px] font-semibold text-[#374151]"
              >
                Business name
              </label>
              <input
                id="business-name"
                name="name"
                required
                maxLength={120}
                placeholder="e.g. Brew & Bite Café"
                autoFocus
                className="w-full rounded-[11px] border border-[#D1D5DB] px-3.5 py-[13px] text-[14.5px] text-[#111827] outline-none focus:border-[#76b900] focus:ring-[3px] focus:ring-[rgba(118,185,0,0.16)]"
              />

              <label
                htmlFor="business-tz"
                className="mb-[7px] mt-4 block text-[12.5px] font-semibold text-[#374151]"
              >
                Time zone
              </label>
              <select
                id="business-tz"
                name="timezone"
                defaultValue="Australia/Sydney"
                className="w-full rounded-[11px] border border-[#D1D5DB] bg-white px-3.5 py-[13px] text-[14.5px] text-[#111827] outline-none focus:border-[#76b900] focus:ring-[3px] focus:ring-[rgba(118,185,0,0.16)]"
              >
                {AU_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace("Australia/", "")}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-[11px] bg-[#76b900] py-3.5 font-archivo text-[15px] font-bold text-[#111827] hover:bg-[#6aa600]"
              >
                Create my business
                <span className="material-symbols-rounded text-[20px]">
                  arrow_forward
                </span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
