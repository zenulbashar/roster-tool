import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ownerRepo, requireOwner } from "@/lib/auth/context";
import { createTenantRepo } from "@/lib/tenant/repository";
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
import { decryptSecret } from "@/lib/crypto";
import {
  googleDriveClient,
  isDriveConfigured,
} from "@/lib/google-drive/client";
import { isXeroConfigured } from "@/lib/xero/client";
import { logger } from "@/lib/logger";
import { initials } from "@/lib/avatar";
import {
  Banner,
  Button,
  ButtonLink,
  Field,
  Icon,
  PageHeader,
  SectionCard,
  Switch,
  TextInput,
} from "@/components/ui";
import { ClearFlashCookie } from "@/components/ClearFlashCookie";
import { UseMyLocationButton } from "@/components/UseMyLocationButton";

const PATH = "/app/settings";
const LINK_COOKIE = "kiosk_link_once";
const CLOCK_LINK_COOKIE = "personal_clock_link_once";
const XERO_INVITE_COOKIE = "xero_invite_once";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    locationSaved?: string;
    driveConnected?: string;
    driveDisconnected?: string;
    driveError?: string;
    xeroConnected?: string;
    xeroConfirmed?: string;
    xeroDisconnected?: string;
    xeroInvited?: string;
    xeroError?: string;
  }>;
}) {
  const sp = await searchParams;
  // One session read for both the account email and the tenant scope (the
  // inline actions below keep using ownerRepo(), which re-validates).
  const owner = await requireOwner();
  const repo = createTenantRepo(owner.businessId);
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

  // Google Drive document storage. The connect/callback live in API routes; the
  // owner manages the connection here.
  const driveConfigured = isDriveConfigured();
  const driveConnection = await repo.getDriveConnection();

  // Xero payroll. Connect/callback live in API routes; the owner connects (or
  // invites a bookkeeper), confirms the org name, and disconnects here.
  const xeroConfigured = isXeroConfigured();
  const xeroConnection = await repo.getXeroConnection();
  const xeroInvites = xeroConnection ? [] : await repo.listXeroConnectInvites();
  const activeXeroInvites = xeroInvites.filter(
    (i) => !i.consumedAt && !i.revokedAt && i.expiresAt > new Date(),
  );
  const freshInviteToken = cookieStore.get(XERO_INVITE_COOKIE)?.value ?? null;
  const freshInviteLink = freshInviteToken
    ? `${env.APP_URL}/xero/connect/${freshInviteToken}`
    : null;

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

  async function setFormDigest(formData: FormData) {
    "use server";
    const formDigestEnabled = formData.get("enabled") === "true";
    const repo = await ownerRepo();
    await repo.updateBusinessSettings({ formDigestEnabled });
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

  async function disconnectDrive() {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const conn = await repo.getDriveConnection();
    if (conn) {
      // Best-effort: tell Google to drop the grant. Files the owner already has
      // in their Drive are theirs and are left untouched.
      try {
        await googleDriveClient.revoke(decryptSecret(conn.refreshTokenEnc));
      } catch (err) {
        logger.warn({ err }, "Drive token revoke on disconnect failed");
      }
      await repo.deleteDriveConnection();
    }
    revalidatePath(PATH);
    redirect(`${PATH}?driveDisconnected=1`);
  }

  // --- Xero payroll actions ----------------------------------------------
  async function confirmXero(formData: FormData) {
    "use server";
    const owner = await requireOwner();
    const repo = createTenantRepo(owner.businessId);
    const expectedTenantId = String(formData.get("tenantId") ?? "");
    // Only activates when the org id matches what the owner was shown.
    await repo.confirmXeroConnection({
      userId: owner.userId,
      expectedTenantId,
    });
    revalidatePath(PATH);
    redirect(`${PATH}?xeroConfirmed=1`);
  }

  async function disconnectXero() {
    "use server";
    const repo = await ownerRepo();
    await repo.deleteXeroConnection();
    revalidatePath(PATH);
    redirect(`${PATH}?xeroDisconnected=1`);
  }

  async function createXeroInvite(formData: FormData) {
    "use server";
    const owner = await requireOwner();
    const repo = createTenantRepo(owner.businessId);
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    if (!email || !email.includes("@")) {
      redirect(
        `${PATH}?xeroError=${encodeURIComponent(
          "Enter a valid email for your bookkeeper.",
        )}`,
      );
    }
    const { token, tokenHash } = generateToken();
    await repo.createXeroConnectInvite({
      tokenHash,
      sentToEmail: email,
      createdByUserId: owner.userId,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72h
    });
    // Show the raw link exactly once (only its hash is stored).
    const store = await cookies();
    store.set(XERO_INVITE_COOKIE, token, {
      path: PATH,
      maxAge: 300,
      httpOnly: false,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
    });
    revalidatePath(PATH);
    redirect(`${PATH}?xeroInvited=1`);
  }

  async function revokeXeroInvite(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    await repo.revokeXeroConnectInvite(String(formData.get("id") ?? ""));
    revalidatePath(PATH);
    redirect(PATH);
  }

  const selectClass =
    "rounded-[8px] border border-[#E5E7EB] bg-white px-[10px] py-[7px] text-[12.5px] font-medium text-[#374151] outline-none focus:border-[var(--color-button)] focus:ring-[3px] focus:ring-[rgba(19,48,31,0.18)]";
  const linkInputClass =
    "min-w-[160px] flex-1 rounded-[9px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-[9px] font-mono text-[12px] text-[#6B7280] outline-none";

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Clock-in links, what you get notified about, and where documents are stored."
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.locationSaved ? (
        <Banner tone="success">Shop location saved.</Banner>
      ) : null}
      {sp.driveConnected ? (
        <Banner tone="success">Google Drive connected.</Banner>
      ) : null}
      {sp.driveDisconnected ? (
        <Banner tone="success">
          Google Drive disconnected. Files already in your Drive are untouched.
        </Banner>
      ) : null}
      {sp.driveError ? <Banner tone="warn">{sp.driveError}</Banner> : null}
      {sp.xeroConnected ? (
        <Banner tone="success">
          Xero connected. Confirm your organisation below to finish.
        </Banner>
      ) : null}
      {sp.xeroConfirmed ? (
        <Banner tone="success">
          Xero organisation confirmed — you can now push approved hours.
        </Banner>
      ) : null}
      {sp.xeroDisconnected ? (
        <Banner tone="success">Xero disconnected.</Banner>
      ) : null}
      {sp.xeroInvited ? (
        <Banner tone="success">
          Bookkeeper invite created — copy the link below and send it to them.
        </Banner>
      ) : null}
      {sp.xeroError ? <Banner tone="warn">{sp.xeroError}</Banner> : null}

      <div className="grid grid-cols-1 items-start gap-[18px] lg:grid-cols-2">
        {/* LEFT COLUMN */}
        <div className="flex flex-col gap-[18px]">
          {/* Account -------------------------------------------------- */}
          <SectionCard title="Account">
            <div className="mb-[14px] flex items-center gap-[11px]">
              <span
                aria-hidden="true"
                className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-full bg-[#111827] font-archivo text-[13px] font-bold text-[#13301F]"
              >
                {initials(business.name)}
              </span>
              <div>
                <div className="text-[14px] font-bold text-[#111827]">
                  {owner.email}
                </div>
                <div className="text-[12px] text-[#6B7280]">Signed in</div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-[#F3F4F6] pt-[13px]">
              <span className="text-[13px] text-[#6B7280]">Business</span>
              <span className="text-[13.5px] font-semibold text-[#111827]">
                {business.name}
              </span>
            </div>
            <p className="mt-3 text-[11.5px] text-[#9CA3AF]">
              Display only — contact support to change account details.
            </p>
          </SectionCard>

          {/* Clock-in ------------------------------------------------- */}
          <SectionCard title="Clock-in">
            {/* Kiosk link */}
            <div className="text-[12.5px] font-semibold text-[#374151]">
              Kiosk link
            </div>
            {freshLink ? (
              <div className="mt-2">
                <ClearFlashCookie name={LINK_COOKIE} />
                <Banner tone="success">
                  Here is your kiosk link. Copy it now — for security we
                  won&apos;t show it again.
                </Banner>
              </div>
            ) : null}
            <div className="mt-[7px] flex flex-wrap gap-2">
              <input
                readOnly
                aria-label="Kiosk link"
                value={
                  freshLink ??
                  (hasKioskLink
                    ? "Link active — generate a new one to reveal it"
                    : "No kiosk link yet")
                }
                className={linkInputClass}
              />
              <form action={generateLink}>
                <Button type="submit" variant="secondary">
                  {hasKioskLink ? "Generate new" : "Create link"}
                </Button>
              </form>
            </div>

            {/* Personal phone link */}
            <div className="mt-4 text-[12.5px] font-semibold text-[#374151]">
              Personal phone link
            </div>
            {!locationSet ? (
              <p className="mt-2 text-[12px] text-[#9CA3AF]">
                Set your shop location below before sharing this link.
              </p>
            ) : null}
            {freshClockLink ? (
              <div className="mt-2">
                <ClearFlashCookie name={CLOCK_LINK_COOKIE} />
                <Banner tone="success">
                  Here is your phone clock-in link. Copy it now — for security
                  we won&apos;t show it again.
                </Banner>
              </div>
            ) : null}
            <div className="mt-[7px] flex flex-wrap gap-2">
              <input
                readOnly
                aria-label="Personal phone link"
                value={
                  freshClockLink ??
                  (hasClockLink
                    ? "Link active — generate a new one to reveal it"
                    : "No phone clock-in link yet")
                }
                className={linkInputClass}
              />
              <form action={generateClockLink}>
                <Button type="submit" variant="secondary">
                  {hasClockLink ? "Regenerate" : "Create link"}
                </Button>
              </form>
            </div>

            {/* Require GPS / shop location */}
            <form
              action={saveLocation}
              className="mt-4 space-y-3 border-t border-[#F3F4F6] pt-[13px]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[13.5px] font-semibold text-[#111827]">
                    Require GPS
                  </div>
                  <div className="text-[12px] text-[#9CA3AF]">
                    Block clock-ins outside the radius
                  </div>
                </div>
                <label className="flex-shrink-0">
                  <span className="sr-only">
                    Allowed distance from the shop
                  </span>
                  <select
                    name="geofenceRadiusM"
                    defaultValue={business.geofenceRadiusM}
                    className={selectClass}
                  >
                    {GEOFENCE_RADIUS_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m} m
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                <Field label="Latitude">
                  <TextInput
                    id="latitude"
                    name="latitude"
                    type="number"
                    step="any"
                    defaultValue={business.latitude ?? ""}
                    placeholder="-33.8688"
                    className="w-[150px]"
                  />
                </Field>
                <Field label="Longitude">
                  <TextInput
                    id="longitude"
                    name="longitude"
                    type="number"
                    step="any"
                    defaultValue={business.longitude ?? ""}
                    placeholder="151.2093"
                    className="w-[150px]"
                  />
                </Field>
              </div>
              <UseMyLocationButton latId="latitude" lngId="longitude" />
              <p className="text-[12px] text-[#9CA3AF]">
                Set where your shop is — stand in the shop and tap “Use my
                current location”, or type the coordinates. Staff must be within
                the chosen distance to clock in on their own phone. (The shared
                kiosk is never location-checked.)
              </p>
              <Button type="submit" variant="secondary">
                Save location
              </Button>
            </form>

            {/* Require photo */}
            <form
              action={togglePhoto}
              className="mt-2 border-t border-[#F3F4F6] pt-[13px]"
            >
              <input
                type="hidden"
                name="requireClockInPhoto"
                value={String(!business.requireClockInPhoto)}
              />
              <button
                type="submit"
                role="switch"
                aria-checked={business.requireClockInPhoto}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <span>
                  <span className="block text-[13.5px] font-semibold text-[#111827]">
                    Require photo on clock-in
                  </span>
                  <span className="block text-[12px] text-[#9CA3AF]">
                    Snap a photo to confirm identity — no facial recognition
                  </span>
                </span>
                <Switch on={business.requireClockInPhoto} />
              </button>
            </form>

            {/* Photo retention */}
            <form
              action={setRetention}
              className="mt-2 flex items-center justify-between gap-3 border-t border-[#F3F4F6] pt-[13px]"
            >
              <div>
                <div className="text-[13.5px] font-semibold text-[#111827]">
                  Photo retention
                </div>
                <div className="text-[12px] text-[#9CA3AF]">
                  Auto-delete clock-in photos after
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label>
                  <span className="sr-only">Delete clock-in photos after</span>
                  <select
                    id="photoRetentionDays"
                    name="photoRetentionDays"
                    defaultValue={business.photoRetentionDays}
                    className={selectClass}
                  >
                    {PHOTO_RETENTION_DAYS.map((days) => (
                      <option key={days} value={days}>
                        {days} days
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" variant="secondary">
                  Save
                </Button>
              </div>
            </form>
          </SectionCard>
        </div>

        {/* RIGHT COLUMN */}
        <div className="flex flex-col gap-[18px]">
          {/* Notifications ------------------------------------------- */}
          <SectionCard title="Notifications" bodyClassName="px-[18px] py-[6px]">
            {NOTIFICATION_TYPES.map((type, i) => {
              const meta = NOTIFICATION_PREFS[type];
              const on = business[meta.column];
              return (
                <form key={type} action={setNotificationPref}>
                  <input type="hidden" name="type" value={type} />
                  <input type="hidden" name="enabled" value={String(!on)} />
                  <button
                    type="submit"
                    role="switch"
                    aria-checked={on}
                    className={`flex w-full items-center justify-between gap-3 py-[12px] text-left ${
                      i === 0 ? "" : "border-t border-[#F3F4F6]"
                    }`}
                  >
                    <span>
                      <span className="block text-[13.5px] font-medium text-[#111827]">
                        {meta.label}
                      </span>
                      <span className="block text-[12px] text-[#9CA3AF]">
                        {meta.description}
                      </span>
                    </span>
                    <Switch on={on} />
                  </button>
                </form>
              );
            })}
            {/* Team notices (daily staff shift reminder) */}
            <form action={setStaffShiftReminders}>
              <input
                type="hidden"
                name="enabled"
                value={String(!business.staffShiftRemindersEnabled)}
              />
              <button
                type="submit"
                role="switch"
                aria-checked={business.staffShiftRemindersEnabled}
                className="flex w-full items-center justify-between gap-3 border-t border-[#F3F4F6] py-[12px] text-left"
              >
                <span>
                  <span className="block text-[13.5px] font-medium text-[#111827]">
                    Team notices (daily shift reminder for staff)
                  </span>
                  <span className="block text-[12px] text-[#9CA3AF]">
                    A private “you work tomorrow” notice — in-app only, never an
                    email.
                  </span>
                </span>
                <Switch on={business.staffShiftRemindersEnabled} />
              </button>
            </form>
            {/* Daily form-response email digest (M35) */}
            <form action={setFormDigest}>
              <input
                type="hidden"
                name="enabled"
                value={String(!business.formDigestEnabled)}
              />
              <button
                type="submit"
                role="switch"
                aria-checked={business.formDigestEnabled}
                className="flex w-full items-center justify-between gap-3 border-t border-[#F3F4F6] py-[12px] text-left"
              >
                <span>
                  <span className="block text-[13.5px] font-medium text-[#111827]">
                    Daily form-response email
                  </span>
                  <span className="block text-[12px] text-[#9CA3AF]">
                    One morning summary of new form responses — counts only,
                    never the answers. Sent only on days something arrived.
                  </span>
                </span>
                <Switch on={business.formDigestEnabled} />
              </button>
            </form>
          </SectionCard>

          {/* Google Drive -------------------------------------------- */}
          <SectionCard title="Google Drive">
            {!driveConfigured ? (
              <Banner tone="info">
                Google Drive isn’t set up on this server yet. Once your
                administrator configures it, you’ll be able to connect here.
              </Banner>
            ) : driveConnection ? (
              <>
                {driveConnection.needsReconnect ? (
                  <div className="mb-[14px]">
                    <Banner tone="warn">
                      Google Drive needs to be reconnected — your access expired
                      or was revoked. Reconnect to upload documents again.
                    </Banner>
                  </div>
                ) : null}
                <div className="mb-[14px] flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[11px] bg-[#ECFDF3]"
                  >
                    <Icon
                      name="check_circle"
                      fill
                      className="text-[24px] text-[#16A34A]"
                    />
                  </span>
                  <div>
                    <div className="text-[14px] font-bold text-[#111827]">
                      Connected as {driveConnection.googleAccountEmail}
                    </div>
                    <div className="text-[12.5px] text-[#6B7280]">
                      {driveConnection.rootFolderId
                        ? "Folder: “Roster Documents” in your Google Drive"
                        : "Documents save to your Google Drive"}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 border-t border-[#F3F4F6] pt-[14px]">
                  {driveConnection.needsReconnect ? (
                    <form
                      action="/api/integrations/google/connect"
                      method="get"
                    >
                      <Button type="submit">Reconnect Google Drive</Button>
                    </form>
                  ) : null}
                  <form action={disconnectDrive}>
                    <button
                      type="submit"
                      className="rounded-[9px] border border-[#FECACA] bg-white px-[15px] py-[9px] text-[13px] font-semibold text-[#B91C1C] transition-colors hover:bg-[#FEF2F2]"
                    >
                      Disconnect
                    </button>
                  </form>
                  <span className="flex-1 text-[11.5px] text-[#9CA3AF]">
                    Disconnecting stops new uploads but keeps files already in
                    your Drive.
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start gap-[13px]">
                  <span
                    aria-hidden="true"
                    className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[11px] bg-[#F3F4F6]"
                  >
                    <Icon
                      name="add_to_drive"
                      className="text-[24px] text-[#9CA3AF]"
                    />
                  </span>
                  <div className="flex-1">
                    <div className="text-[14px] font-bold text-[#111827]">
                      Connect Google Drive
                    </div>
                    <div className="mt-[3px] text-[12.5px] leading-[1.5] text-[#6B7280]">
                      Store staff documents securely in your own Drive.
                      Contracts, RSA certificates, ID — everything stays in your
                      account, not ours. This is a separate permission from how
                      you sign in and doesn’t change your login.
                    </div>
                  </div>
                </div>
                <form
                  action="/api/integrations/google/connect"
                  method="get"
                  className="mt-[14px]"
                >
                  <Button type="submit" className="w-full">
                    Connect Google Drive
                  </Button>
                </form>
              </>
            )}
          </SectionCard>

          {/* Xero Payroll -------------------------------------------- */}
          <SectionCard title="Xero Payroll">
            {!xeroConfigured ? (
              <Banner tone="info">
                Xero isn’t set up on this server yet. Once your administrator
                configures it, you’ll be able to connect here.
              </Banner>
            ) : xeroConnection ? (
              <>
                {xeroConnection.status === "pending_confirmation" ? (
                  <div className="mb-[14px]">
                    <Banner tone="info">
                      Connected to <strong>{xeroConnection.orgName}</strong>
                      {xeroConnection.connectedAccountEmail
                        ? ` (${xeroConnection.connectedAccountEmail})`
                        : ""}
                      . Is this your Xero organisation? Confirm to finish —
                      nothing can be pushed until you do.
                    </Banner>
                    <form action={confirmXero} className="mt-[12px]">
                      <input
                        type="hidden"
                        name="tenantId"
                        value={xeroConnection.xeroTenantId}
                      />
                      <Button type="submit">
                        Yes — that’s my organisation
                      </Button>
                    </form>
                  </div>
                ) : (
                  <>
                    {xeroConnection.needsReconnect ? (
                      <div className="mb-[14px]">
                        <Banner tone="warn">
                          Xero needs to be reconnected — access expired or was
                          revoked.
                        </Banner>
                      </div>
                    ) : null}
                    <div className="mb-[14px] flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[11px] bg-[#ECFDF3]"
                      >
                        <Icon
                          name="check_circle"
                          fill
                          className="text-[24px] text-[#16A34A]"
                        />
                      </span>
                      <div>
                        <div className="text-[14px] font-bold text-[#111827]">
                          Connected to {xeroConnection.orgName}
                        </div>
                        <div className="text-[12.5px] text-[#6B7280]">
                          {xeroConnection.connectedAccountEmail ||
                            "Xero organisation"}{" "}
                          · draft timesheets only
                        </div>
                      </div>
                    </div>
                    <div className="mb-[14px] flex flex-wrap gap-2">
                      <ButtonLink href="/app/xero" variant="secondary">
                        Map staff to Xero
                      </ButtonLink>
                      <ButtonLink href="/app/timesheets" variant="ghost">
                        Push hours from Timesheets
                      </ButtonLink>
                    </div>
                  </>
                )}
                <div className="flex flex-wrap items-center gap-3 border-t border-[#F3F4F6] pt-[14px]">
                  {xeroConnection.needsReconnect ? (
                    <form action="/api/integrations/xero/connect" method="get">
                      <Button type="submit">Reconnect Xero</Button>
                    </form>
                  ) : null}
                  <form action={disconnectXero}>
                    <button
                      type="submit"
                      className="rounded-[9px] border border-[#FECACA] bg-white px-[15px] py-[9px] text-[13px] font-semibold text-[#B91C1C] transition-colors hover:bg-[#FEF2F2]"
                    >
                      Disconnect
                    </button>
                  </form>
                  <span className="flex-1 text-[11.5px] text-[#9CA3AF]">
                    Roster only ever creates DRAFT timesheets — you approve and
                    run pay in Xero.
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start gap-[13px]">
                  <span
                    aria-hidden="true"
                    className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[11px] bg-[#F3F4F6]"
                  >
                    <Icon
                      name="sync_alt"
                      className="text-[24px] text-[#9CA3AF]"
                    />
                  </span>
                  <div className="flex-1">
                    <div className="text-[14px] font-bold text-[#111827]">
                      Connect Xero
                    </div>
                    <div className="mt-[3px] text-[12.5px] leading-[1.5] text-[#6B7280]">
                      Push approved hours to Xero as <strong>draft</strong>{" "}
                      timesheets for a human to review and run. Roster never
                      calculates or finalises pay. The person who authorises
                      must be a Xero payroll administrator.
                    </div>
                  </div>
                </div>
                <form
                  action="/api/integrations/xero/connect"
                  method="get"
                  className="mt-[14px]"
                >
                  <Button type="submit" className="w-full">
                    Connect Xero
                  </Button>
                </form>

                {/* Delegated bookkeeper invite */}
                <div className="mt-[16px] border-t border-[#F3F4F6] pt-[14px]">
                  <div className="text-[13px] font-bold text-[#111827]">
                    Not the payroll admin? Invite your bookkeeper
                  </div>
                  <div className="mt-[3px] text-[12px] leading-[1.5] text-[#6B7280]">
                    Send a one-time link so your bookkeeper or accountant can
                    connect Xero for you. You’ll still confirm the organisation
                    before anything can be pushed.
                  </div>
                  {freshInviteLink ? (
                    <div className="mt-[12px]">
                      <ClearFlashCookie name={XERO_INVITE_COOKIE} />
                      <Banner tone="success">
                        Copy this link now — for security we won’t show it
                        again.
                      </Banner>
                      <input
                        readOnly
                        aria-label="Bookkeeper connect link"
                        value={freshInviteLink}
                        className={`${linkInputClass} mt-[7px] w-full`}
                      />
                    </div>
                  ) : null}
                  <form
                    action={createXeroInvite}
                    className="mt-[12px] flex flex-wrap gap-2"
                  >
                    <input
                      type="email"
                      name="email"
                      required
                      placeholder="bookkeeper@example.com"
                      aria-label="Bookkeeper email"
                      className="min-w-[180px] flex-1 rounded-[9px] border border-[#E5E7EB] px-3 py-[9px] text-[13px] text-[#374151] outline-none focus:border-[var(--color-button)] focus:ring-[3px] focus:ring-[rgba(19,48,31,0.18)]"
                    />
                    <Button type="submit" variant="secondary">
                      Create invite link
                    </Button>
                  </form>
                  {activeXeroInvites.length > 0 ? (
                    <div className="mt-[12px] flex flex-col gap-[8px]">
                      {activeXeroInvites.map((inv) => (
                        <div
                          key={inv.id}
                          className="flex items-center justify-between gap-3 rounded-[9px] bg-[#F9FAFB] px-[11px] py-[8px]"
                        >
                          <span className="text-[12.5px] text-[#374151]">
                            Invite for {inv.sentToEmail}
                          </span>
                          <form action={revokeXeroInvite}>
                            <input type="hidden" name="id" value={inv.id} />
                            <button
                              type="submit"
                              className="text-[12px] font-semibold text-[#B91C1C] hover:underline"
                            >
                              Revoke
                            </button>
                          </form>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}
