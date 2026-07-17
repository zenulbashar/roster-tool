import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { signOut } from "@/lib/auth";
import { requireSession } from "@/lib/auth/context";
import { db } from "@/lib/db";
import {
  businesses,
  users,
  organisations,
  orgMemberships,
} from "@/lib/db/schema";
import { setActiveLocationCookie } from "@/lib/tenant/org-access";
import { AccountIdentity } from "@/components/AccountIdentity";
import { AU_TIMEZONES } from "@/lib/timezones";

const onboardingSchema = z.object({
  name: z.string().trim().min(1, "Please enter your business name").max(120),
  timezone: z.enum(AU_TIMEZONES),
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

    // Create the organisation, its first location, and the owner's membership
    // atomically (M29). The business name seeds both; the owner can rename the
    // org and add more locations later. `user.businessId` records the home
    // location (used as the active-location fallback).
    const businessId = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organisations)
        .values({
          name: parsed.data.name,
          defaultTimezone: parsed.data.timezone,
        })
        .returning();
      const [business] = await tx
        .insert(businesses)
        .values({
          name: parsed.data.name,
          timezone: parsed.data.timezone,
          orgId: org!.id,
        })
        .returning();
      await tx.insert(orgMemberships).values({
        orgId: org!.id,
        userId: current.user.id,
        role: "owner",
      });
      await tx
        .update(users)
        .set({ businessId: business!.id })
        .where(eq(users.id, current.user.id));
      return business!.id;
    });

    await setActiveLocationCookie(businessId);
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
          "radial-gradient(circle at 50% 0, #ECF3EE, #F9FAFB 60%)",
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
            <span className="material-symbols-rounded text-[20px] text-[#13301F]">
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
                  className="whitespace-nowrap text-[12.5px] font-semibold text-[#2E7D4E] hover:underline"
                >
                  Sign out
                </button>
              </form>
            </AccountIdentity>
          </div>

          <div className="p-[30px]">
            <div className="font-archivo text-[11.5px] font-bold uppercase tracking-[0.08em] text-[#13301F]">
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
                className="w-full rounded-[11px] border border-[#D1D5DB] px-3.5 py-[13px] text-[14.5px] text-[#111827] outline-none focus:border-[#13301F] focus:ring-[3px] focus:ring-[rgba(19,48,31,0.18)]"
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
                className="w-full rounded-[11px] border border-[#D1D5DB] bg-white px-3.5 py-[13px] text-[14.5px] text-[#111827] outline-none focus:border-[#13301F] focus:ring-[3px] focus:ring-[rgba(19,48,31,0.18)]"
              >
                {AU_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace("Australia/", "")}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-[11px] bg-[#13301F] py-3.5 font-archivo text-[15px] font-bold text-white hover:bg-[#1D4A2E]"
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
