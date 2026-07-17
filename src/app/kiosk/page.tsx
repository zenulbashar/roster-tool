import Link from "next/link";
import { cookies } from "next/headers";
import { createTenantRepo } from "@/lib/tenant/repository";
import { createOrgRepo } from "@/lib/tenant/org-repository";
import { resolveKioskBusiness } from "@/lib/tenant/kiosk-access";
import { resolveOrgIdForBusiness } from "@/lib/tenant/org-access";
import { KIOSK_COOKIE } from "@/lib/kiosk-cookie";
import { Avatar } from "@/components/ui";
import { KioskClockForm } from "@/components/KioskClockForm";
import { LeaveRequestForm } from "@/components/LeaveRequestForm";
import { StockCheckForm } from "@/components/StockCheckForm";
import { PinActionForm } from "@/components/PinActionForm";
import {
  MyShiftsList,
  OpenShiftsList,
  OtherLocationOffers,
  StaffShiftMenu,
  StaffShiftBackLinks,
} from "@/components/StaffShiftLists";
import {
  kioskLeaveAction,
  kioskReleaseAction,
  kioskClaimAction,
  kioskClaimOrgAction,
  kioskCancelOfferAction,
  kioskStockCheckAction,
} from "@/app/kiosk/actions";
import { businessDateOf, formatDateOnly, formatTimeRange } from "@/lib/time";

export const dynamic = "force-dynamic";

function shiftDetail(s: {
  date: string;
  label: string;
  startTime: string;
  endTime: string;
}) {
  return `${formatDateOnly(s.date)} · ${s.label} · ${formatTimeRange(s.startTime, s.endTime)}`;
}

/** Dark kiosk header: ROSTER · Kiosk, tenant name, current local date/time. */
function KioskHeader({ name, timezone }: { name: string; timezone: string }) {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: timezone,
  }).format(now);
  const timeStr = new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  })
    .format(now)
    .toLowerCase();
  return (
    <>
      <div className="mb-1.5 flex w-full items-center justify-between">
        <span className="flex items-center gap-2.5">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-[#76b900]">
            <span className="material-symbols-rounded text-[17px] text-[#111827]">
              grid_view
            </span>
          </span>
          <span className="font-archivo text-[16px] font-extrabold tracking-[0.05em] text-[#76b900]">
            ROSTER
          </span>
        </span>
        <span className="text-[13px] text-[#9CA3AF]">Kiosk</span>
      </div>
      <div className="mb-[26px] text-center">
        <div className="font-archivo text-[22px] font-extrabold text-white">
          {name}
        </div>
        <div className="mt-0.5 text-[14px] text-[#9CA3AF]">
          {dateStr} · {timeStr}
        </div>
      </div>
    </>
  );
}

export default async function KioskPage({
  searchParams,
}: {
  searchParams: Promise<{
    staff?: string;
    mode?: string;
    shift?: string;
    offer?: string;
  }>;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(KIOSK_COOKIE)?.value ?? "";
  const business = await resolveKioskBusiness(token);

  if (!business) {
    return (
      <div className="mt-8 rounded-[18px] border border-[#2A3344] bg-[#1C2433] p-8 text-center">
        <h1 className="font-archivo text-[20px] font-extrabold text-white">
          Kiosk not set up
        </h1>
        <p className="mt-2 text-[#9CA3AF]">
          This link is no longer active. Ask your manager for the current
          clock-in link.
        </p>
      </div>
    );
  }

  const repo = createTenantRepo(business.businessId);
  const staff = await repo.listActiveStaffForKiosk();
  const {
    staff: selectedId,
    mode,
    shift: shiftParam,
    offer: offerParam,
  } = await searchParams;
  const selected = selectedId
    ? staff.find((s) => s.id === selectedId)
    : undefined;

  if (selected) {
    const myShiftsHref = `/kiosk?staff=${selected.id}&mode=myshifts`;

    if (mode === "leave") {
      return (
        <LeaveRequestForm
          action={kioskLeaveAction}
          staffId={selected.id}
          staffName={selected.name}
          backHref="/kiosk"
        />
      );
    }

    if (mode === "stock") {
      const items = await repo.listActiveItemsForStockCheck();
      return (
        <StockCheckForm
          action={kioskStockCheckAction}
          staffId={selected.id}
          staffName={selected.name}
          items={items}
          backHref={`/kiosk?staff=${selected.id}`}
        />
      );
    }

    if (mode === "myshifts") {
      const today = businessDateOf(new Date(), business.timezone);
      const shifts = await repo.listUpcomingShiftsForStaff(selected.id, today);
      return (
        <>
          <header className="mb-4 text-center">
            <h1 className="font-archivo text-2xl font-extrabold text-white">
              {selected.name}&apos;s shifts
            </h1>
            <p className="mt-1 text-[#9CA3AF]">
              Offer up a shift you can&apos;t make. You stay on it until your
              manager confirms a replacement.
            </p>
          </header>
          <MyShiftsList
            shifts={shifts}
            basePath="/kiosk"
            staffId={selected.id}
          />
          <StaffShiftBackLinks basePath="/kiosk" staffId={selected.id} />
        </>
      );
    }

    if (mode === "open") {
      const orgId = await resolveOrgIdForBusiness(business.businessId);
      const [offers, orgOffers] = await Promise.all([
        repo.listOpenOffers(),
        orgId
          ? createOrgRepo(orgId).listOrgOpenOffers({
              excludeBusinessId: business.businessId,
              excludeStaffId: selected.id,
            })
          : Promise.resolve([]),
      ]);
      return (
        <>
          <header className="mb-4 text-center">
            <h1 className="font-archivo text-2xl font-extrabold text-white">
              Open shifts
            </h1>
            <p className="mt-1 text-[#9CA3AF]">
              Shifts up for grabs. Claim one and your manager will confirm it.
            </p>
          </header>
          <OpenShiftsList
            offers={offers}
            basePath="/kiosk"
            staffId={selected.id}
          />
          <OtherLocationOffers
            offers={orgOffers}
            basePath="/kiosk"
            staffId={selected.id}
          />
          <StaffShiftBackLinks basePath="/kiosk" staffId={selected.id} />
        </>
      );
    }

    if (mode === "release" && shiftParam) {
      const shift = await repo.getPublishedShift(shiftParam);
      if (shift) {
        return (
          <PinActionForm
            action={kioskReleaseAction}
            heading="Offer up this shift?"
            details={shiftDetail(shift)}
            hiddenName="shiftId"
            hiddenValue={shift.id}
            submitLabel="Offer it up"
            backHref={myShiftsHref}
          />
        );
      }
    }

    if (mode === "claim" && offerParam) {
      const offer = await repo.getOffer(offerParam);
      const shift = offer ? await repo.getPublishedShift(offer.shiftId) : null;
      if (offer && offer.status === "open" && shift) {
        return (
          <PinActionForm
            action={kioskClaimAction}
            heading="Claim this shift?"
            details={shiftDetail(shift)}
            hiddenName="offerId"
            hiddenValue={offer.id}
            submitLabel="Claim it"
            backHref={`/kiosk?staff=${selected.id}&mode=open`}
          />
        );
      }
    }

    if (mode === "claimorg" && offerParam) {
      const orgId = await resolveOrgIdForBusiness(business.businessId);
      const offer = orgId
        ? await createOrgRepo(orgId).getOrgOffer(offerParam)
        : null;
      if (offer && offer.status === "open") {
        return (
          <PinActionForm
            action={kioskClaimOrgAction}
            heading="Cover this shift?"
            details={
              <>
                {shiftDetail(offer)}
                <span className="mt-1 block">at {offer.locationName}</span>
              </>
            }
            hiddenName="offerId"
            hiddenValue={offer.offerId}
            submitLabel="Offer to cover it"
            backHref={`/kiosk?staff=${selected.id}&mode=open`}
          />
        );
      }
    }

    if (mode === "cancel" && offerParam) {
      const offer = await repo.getOffer(offerParam);
      const shift = offer ? await repo.getPublishedShift(offer.shiftId) : null;
      if (offer && offer.status === "open" && shift) {
        return (
          <PinActionForm
            action={kioskCancelOfferAction}
            heading="Cancel this offer?"
            details={shiftDetail(shift)}
            hiddenName="offerId"
            hiddenValue={offer.id}
            submitLabel="Cancel offer"
            backHref={myShiftsHref}
          />
        );
      }
    }

    const open = await repo.getOpenEntry(selected.id);
    return (
      <>
        <KioskHeader name={business.name} timezone={business.timezone} />
        <KioskClockForm
          staffId={selected.id}
          staffName={selected.name}
          currentlyIn={open !== null}
          requirePhoto={business.requireClockInPhoto}
        />
        <StaffShiftMenu basePath="/kiosk" staffId={selected.id} />
      </>
    );
  }

  return (
    <>
      <KioskHeader name={business.name} timezone={business.timezone} />
      {staff.length === 0 ? (
        <div className="rounded-[18px] border border-[#2A3344] bg-[#1C2433] p-6 text-center text-[#9CA3AF]">
          No staff yet. Your manager can add team members and PINs.
        </div>
      ) : (
        <>
          <p className="mb-5 text-center text-[15px] text-[#CBD5E1]">
            Tap your name to start
          </p>
          <ul className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
            {staff.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/kiosk?staff=${s.id}`}
                  className="flex flex-col items-center gap-[11px] rounded-[18px] border border-[#2A3344] bg-[#1C2433] p-[22px] transition-colors hover:border-[#76b900] hover:bg-[#222C3D]"
                >
                  <Avatar name={s.name} colorKey={s.id} size={52} />
                  <span className="font-archivo text-[15px] font-bold text-white">
                    {s.name.split(" ")[0]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
