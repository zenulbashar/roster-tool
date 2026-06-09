import Link from "next/link";
import { cookies } from "next/headers";
import { createTenantRepo } from "@/lib/tenant/repository";
import { resolveKioskBusiness } from "@/lib/tenant/kiosk-access";
import { KIOSK_COOKIE } from "@/lib/kiosk-cookie";
import { Card } from "@/components/ui";
import { KioskClockForm } from "@/components/KioskClockForm";
import { LeaveRequestForm } from "@/components/LeaveRequestForm";
import { StockCheckForm } from "@/components/StockCheckForm";
import { PinActionForm } from "@/components/PinActionForm";
import {
  MyShiftsList,
  OpenShiftsList,
  StaffShiftMenu,
  StaffShiftBackLinks,
} from "@/components/StaffShiftLists";
import {
  kioskLeaveAction,
  kioskReleaseAction,
  kioskClaimAction,
  kioskCancelOfferAction,
  kioskStockCheckAction,
} from "@/app/kiosk/actions";
import { businessDateOf, formatDateOnly, formatTimeOnly } from "@/lib/time";

export const dynamic = "force-dynamic";

function shiftDetail(s: {
  date: string;
  label: string;
  startTime: string;
  endTime: string;
}) {
  return `${formatDateOnly(s.date)} · ${s.label} · ${formatTimeOnly(s.startTime)} – ${formatTimeOnly(s.endTime)}`;
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
      <Card className="mt-8 text-center">
        <h1 className="text-xl font-bold">Kiosk not set up</h1>
        <p className="mt-2 text-[var(--color-muted)]">
          This link is no longer active. Ask your manager for the current
          clock-in link.
        </p>
      </Card>
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
            <h1 className="text-2xl font-bold">
              {selected.name}&apos;s shifts
            </h1>
            <p className="mt-1 text-[var(--color-muted)]">
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
      const offers = await repo.listOpenOffers();
      return (
        <>
          <header className="mb-4 text-center">
            <h1 className="text-2xl font-bold">Open shifts</h1>
            <p className="mt-1 text-[var(--color-muted)]">
              Shifts up for grabs. Claim one and your manager will confirm it.
            </p>
          </header>
          <OpenShiftsList
            offers={offers}
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
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold">{business.name}</h1>
        <p className="mt-1 text-[var(--color-muted)]">
          Tap your name to clock in or out.
        </p>
      </header>
      {staff.length === 0 ? (
        <Card className="text-center text-[var(--color-muted)]">
          No staff yet. Your manager can add team members and PINs.
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {staff.map((s) => (
            <li key={s.id}>
              <Link
                href={`/kiosk?staff=${s.id}`}
                className="flex min-h-20 items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-center text-lg font-semibold hover:bg-[var(--color-canvas)]"
              >
                {s.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
