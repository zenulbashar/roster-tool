import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ownerRepo } from "@/lib/auth/context";
import { env } from "@/lib/env";
import { generateToken } from "@/lib/tokens";
import { PHOTO_RETENTION_DAYS, parsePhotoRetentionDays } from "@/lib/retention";
import { Banner, Button, Card, PageHeader } from "@/components/ui";
import { ClearFlashCookie } from "@/components/ClearFlashCookie";

const PATH = "/app/settings";
const LINK_COOKIE = "kiosk_link_once";

export default async function SettingsPage() {
  const repo = await ownerRepo();
  const business = await repo.getBusiness();
  if (!business) redirect("/onboarding");

  // The raw kiosk token is shown exactly once, just after it's generated. We
  // only ever store its hash, so it can't be re-displayed later.
  const cookieStore = await cookies();
  const freshToken = cookieStore.get(LINK_COOKIE)?.value ?? null;
  const freshLink = freshToken ? `${env.APP_URL}/kiosk/${freshToken}` : null;
  const hasKioskLink = Boolean(business.kioskTokenHash);

  async function togglePhoto(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const requireClockInPhoto = formData.get("requireClockInPhoto") === "true";
    await repo.updateBusinessSettings({ requireClockInPhoto });
    revalidatePath(PATH);
  }

  async function setRetention(formData: FormData) {
    "use server";
    const photoRetentionDays = parsePhotoRetentionDays(
      Number(formData.get("photoRetentionDays")),
    );
    // Reject anything outside the allowed 7/30/90 set; retention is always on,
    // so we never clear it.
    if (photoRetentionDays === null) return;
    const repo = await ownerRepo();
    await repo.updateBusinessSettings({ photoRetentionDays });
    revalidatePath(PATH);
  }

  async function generateLink() {
    "use server";
    const repo = await ownerRepo();
    const { token, tokenHash } = generateToken();
    await repo.updateBusinessSettings({ kioskTokenHash: tokenHash });
    // Stash the raw token in a short-lived flash cookie so the next render can
    // show the full link once. Not httpOnly: a small client component clears it
    // after display. Scoped to this page only.
    const cookieStore = await cookies();
    cookieStore.set(LINK_COOKIE, token, {
      path: PATH,
      maxAge: 300,
      httpOnly: false,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
    });
    revalidatePath(PATH);
    redirect(PATH);
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Clock-in kiosk and timesheet options."
      />

      <Card className="mt-4">
        <h2 className="text-lg font-semibold">Clock-in kiosk</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Open this link on a shared device (a tablet by the door, say). Staff
          tap their name and type their PIN to clock in and out. Anyone with the
          link can reach the kiosk, so keep it to your device — you can replace
          it any time, which instantly disables the old one.
        </p>

        {freshLink ? (
          <div className="mt-4">
            <ClearFlashCookie name={LINK_COOKIE} />
            <Banner tone="success">
              Here is your kiosk link. Copy it now — for security we won&apos;t
              show it again.
            </Banner>
            <p className="mt-2 break-all rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 font-mono text-sm">
              {freshLink}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm">
            Status:{" "}
            <span className="font-semibold">
              {hasKioskLink ? "A kiosk link is active." : "No kiosk link yet."}
            </span>
          </p>
        )}

        <form action={generateLink} className="mt-4">
          <Button
            type="submit"
            variant={hasKioskLink ? "secondary" : "primary"}
          >
            {hasKioskLink ? "Replace kiosk link" : "Create kiosk link"}
          </Button>
        </form>
      </Card>

      <Card className="mt-6">
        <h2 className="text-lg font-semibold">Clock-in photo</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          When on, the kiosk takes a quick photo each time someone clocks in or
          out, so you can confirm who it was. Photos are stored with the
          timesheet — there&apos;s no facial recognition. If the camera
          isn&apos;t available, clocking in still works with just the PIN.
        </p>
        <form action={togglePhoto} className="mt-3">
          <input
            type="hidden"
            name="requireClockInPhoto"
            value={String(!business.requireClockInPhoto)}
          />
          <button
            type="submit"
            role="switch"
            aria-checked={business.requireClockInPhoto}
            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-ink)]"
          >
            <span
              aria-hidden="true"
              className={`inline-flex h-5 w-9 items-center rounded-full border px-0.5 transition-colors ${
                business.requireClockInPhoto
                  ? "justify-end border-[var(--color-ok)] bg-[var(--color-ok)]"
                  : "justify-start border-[var(--color-line)] bg-[var(--color-canvas)]"
              }`}
            >
              <span className="h-4 w-4 rounded-full bg-white" />
            </span>
            Take a photo at clock in/out
            <span className="text-[var(--color-muted)]">
              {business.requireClockInPhoto ? "On" : "Off"}
            </span>
          </button>
        </form>

        <div className="mt-6 border-t border-[var(--color-line)] pt-4">
          <h3 className="text-base font-semibold">
            Delete clock-in photos after
          </h3>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Photos are automatically deleted after this period — the timesheet
            entry and hours are always kept. This runs every day.
          </p>
          <form
            action={setRetention}
            className="mt-3 flex flex-wrap items-center gap-3"
          >
            <label htmlFor="photoRetentionDays" className="sr-only">
              Delete clock-in photos after
            </label>
            <select
              id="photoRetentionDays"
              name="photoRetentionDays"
              defaultValue={business.photoRetentionDays}
              className="rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 text-sm font-medium text-[var(--color-ink)]"
            >
              {PHOTO_RETENTION_DAYS.map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary">
              Save
            </Button>
          </form>
        </div>
      </Card>
    </>
  );
}
