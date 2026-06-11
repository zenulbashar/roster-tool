import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ownerRepo } from "@/lib/auth/context";
import { env } from "@/lib/env";
import { generateToken } from "@/lib/tokens";
import { PHOTO_RETENTION_DAYS, parsePhotoRetentionDays } from "@/lib/retention";
import {
  coordinatesSchema,
  parseGeofenceRadius,
  GEOFENCE_RADIUS_OPTIONS,
} from "@/lib/validation";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_PREFS,
  type NotificationType,
} from "@/lib/notifications";
import { Banner, Button, Card, PageHeader } from "@/components/ui";
import { ClearFlashCookie } from "@/components/ClearFlashCookie";
import { UseMyLocationButton } from "@/components/UseMyLocationButton";

const PATH = "/app/settings";
const LINK_COOKIE = "kiosk_link_once";
const CLOCK_LINK_COOKIE = "personal_clock_link_once";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; locationSaved?: string }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const business = await repo.getBusiness();
  if (!business) redirect("/onboarding");

  // The raw kiosk token is shown exactly once, just after it's generated. We
  // only ever store its hash, so it can't be re-displayed later.
  const cookieStore = await cookies();
  const freshToken = cookieStore.get(LINK_COOKIE)?.value ?? null;
  const freshLink = freshToken ? `${env.APP_URL}/kiosk/${freshToken}` : null;
  const hasKioskLink = Boolean(business.kioskTokenHash);

  // Same once-only flash pattern for the separate personal-phone clock-in link.
  const freshClockToken = cookieStore.get(CLOCK_LINK_COOKIE)?.value ?? null;
  const freshClockLink = freshClockToken
    ? `${env.APP_URL}/clock/${freshClockToken}`
    : null;
  const hasClockLink = Boolean(business.personalClockTokenHash);
  const locationSet = business.latitude !== null && business.longitude !== null;

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

  async function saveLocation(formData: FormData) {
    "use server";
    const coords = coordinatesSchema.safeParse({
      lat: formData.get("latitude"),
      lng: formData.get("longitude"),
    });
    const radius = parseGeofenceRadius(formData.get("geofenceRadiusM"));
    if (!coords.success || radius === null) {
      redirect(
        `${PATH}?error=${encodeURIComponent("Enter a valid location and radius")}`,
      );
    }
    const repo = await ownerRepo();
    await repo.updateBusinessSettings({
      latitude: coords.data.lat,
      longitude: coords.data.lng,
      geofenceRadiusM: radius,
    });
    revalidatePath(PATH);
    redirect(`${PATH}?locationSaved=1`);
  }

  async function setNotificationPref(formData: FormData) {
    "use server";
    const type = formData.get("type");
    if (
      typeof type !== "string" ||
      !(NOTIFICATION_TYPES as readonly string[]).includes(type)
    ) {
      return;
    }
    const enabled = formData.get("enabled") === "true";
    const column = NOTIFICATION_PREFS[type as NotificationType].column;
    const repo = await ownerRepo();
    await repo.updateNotificationPrefs({ [column]: enabled });
    revalidatePath(PATH);
  }

  async function setStaffShiftReminders(formData: FormData) {
    "use server";
    const staffShiftRemindersEnabled = formData.get("enabled") === "true";
    const repo = await ownerRepo();
    await repo.updateBusinessSettings({ staffShiftRemindersEnabled });
    revalidatePath(PATH);
  }

  async function generateClockLink() {
    "use server";
    const repo = await ownerRepo();
    const { token, tokenHash } = generateToken();
    await repo.updateBusinessSettings({ personalClockTokenHash: tokenHash });
    const cookieStore = await cookies();
    cookieStore.set(CLOCK_LINK_COOKIE, token, {
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

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.locationSaved ? (
        <Banner tone="success">Shop location saved.</Banner>
      ) : null}

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

      <Card className="mt-6">
        <h2 className="text-lg font-semibold">Phone clock-in (location)</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Let staff clock in from their own phones, checked against the
          shop&apos;s location. Set where your shop is — stand in the shop and
          tap “Use my current location”, or type the coordinates. Staff must be
          within the chosen distance of this spot to clock in on their phone.
          (The shared kiosk is never location-checked.)
        </p>

        <form action={saveLocation} className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">Latitude</span>
              <input
                id="latitude"
                name="latitude"
                type="number"
                step="any"
                defaultValue={business.latitude ?? ""}
                placeholder="-33.8688"
                className="w-40 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">
                Longitude
              </span>
              <input
                id="longitude"
                name="longitude"
                type="number"
                step="any"
                defaultValue={business.longitude ?? ""}
                placeholder="151.2093"
                className="w-40 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              />
            </label>
          </div>

          <UseMyLocationButton latId="latitude" lngId="longitude" />

          <label className="block">
            <span className="mb-1 block text-sm font-semibold">
              Allowed distance from the shop
            </span>
            <select
              name="geofenceRadiusM"
              defaultValue={business.geofenceRadiusM}
              className="rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 text-sm font-medium text-[var(--color-ink)]"
            >
              {GEOFENCE_RADIUS_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} m
                </option>
              ))}
            </select>
            <span className="mt-1 block text-sm text-[var(--color-muted)]">
              A staff member&apos;s phone must be within this distance of the
              shop to clock in.
            </span>
          </label>

          <Button type="submit">Save location</Button>
        </form>

        <div className="mt-6 border-t border-[var(--color-line)] pt-4">
          <h3 className="text-base font-semibold">Phone clock-in link</h3>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Share this separate link with staff for their own phones. It only
            opens the location-checked clock-in — not the kiosk. Set your shop
            location first. Replace it any time to disable the old one.
          </p>

          {!locationSet ? (
            <p className="mt-3">
              <Banner tone="info">
                Set your shop location above before sharing the link.
              </Banner>
            </p>
          ) : null}

          {freshClockLink ? (
            <div className="mt-4">
              <ClearFlashCookie name={CLOCK_LINK_COOKIE} />
              <Banner tone="success">
                Here is your phone clock-in link. Copy it now — for security we
                won&apos;t show it again.
              </Banner>
              <p className="mt-2 break-all rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 font-mono text-sm">
                {freshClockLink}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm">
              Status:{" "}
              <span className="font-semibold">
                {hasClockLink
                  ? "A phone clock-in link is active."
                  : "No phone clock-in link yet."}
              </span>
            </p>
          )}

          <form action={generateClockLink} className="mt-4">
            <Button
              type="submit"
              variant={hasClockLink ? "secondary" : "primary"}
            >
              {hasClockLink
                ? "Replace phone clock-in link"
                : "Create phone clock-in link"}
            </Button>
          </form>
        </div>
      </Card>

      <Card className="mt-6">
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Choose which activity shows in the bell at the top of the page. These
          are in-app only — turning one off doesn&apos;t change any emails you
          already get.
        </p>
        <ul className="mt-4 space-y-3">
          {NOTIFICATION_TYPES.map((type) => {
            const meta = NOTIFICATION_PREFS[type];
            const on = business[meta.column];
            return (
              <li key={type}>
                <form action={setNotificationPref}>
                  <input type="hidden" name="type" value={type} />
                  <input type="hidden" name="enabled" value={String(!on)} />
                  <button
                    type="submit"
                    role="switch"
                    aria-checked={on}
                    className="flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-[var(--color-ink)]"
                  >
                    <span>
                      <span className="block">{meta.label}</span>
                      <span className="block text-sm font-normal text-[var(--color-muted)]">
                        {meta.description}
                      </span>
                    </span>
                    <span className="flex flex-shrink-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`inline-flex h-5 w-9 items-center rounded-full border px-0.5 transition-colors ${
                          on
                            ? "justify-end border-[var(--color-ok)] bg-[var(--color-ok)]"
                            : "justify-start border-[var(--color-line)] bg-[var(--color-canvas)]"
                        }`}
                      >
                        <span className="h-4 w-4 rounded-full bg-white" />
                      </span>
                      <span className="w-7 text-[var(--color-muted)]">
                        {on ? "On" : "Off"}
                      </span>
                    </span>
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="mt-6">
        <h2 className="text-lg font-semibold">Team notices</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Each team member can have a private notices page (you share their link
          from the Staff page). The night before a shift we add a &quot;you work
          tomorrow&quot; reminder there — in-app only, never an email.
        </p>
        <form action={setStaffShiftReminders} className="mt-4">
          <input
            type="hidden"
            name="enabled"
            value={String(!business.staffShiftRemindersEnabled)}
          />
          <button
            type="submit"
            role="switch"
            aria-checked={business.staffShiftRemindersEnabled}
            className="flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-[var(--color-ink)]"
          >
            <span>
              <span className="block">Daily shift reminders</span>
              <span className="block text-sm font-normal text-[var(--color-muted)]">
                A notice the evening before each rostered shift.
              </span>
            </span>
            <span className="flex flex-shrink-0 items-center gap-2">
              <span
                aria-hidden="true"
                className={`inline-flex h-5 w-9 items-center rounded-full border px-0.5 transition-colors ${
                  business.staffShiftRemindersEnabled
                    ? "justify-end border-[var(--color-ok)] bg-[var(--color-ok)]"
                    : "justify-start border-[var(--color-line)] bg-[var(--color-canvas)]"
                }`}
              >
                <span className="h-4 w-4 rounded-full bg-white" />
              </span>
              <span className="w-7 text-[var(--color-muted)]">
                {business.staffShiftRemindersEnabled ? "On" : "Off"}
              </span>
            </span>
          </button>
        </form>
      </Card>
    </>
  );
}
