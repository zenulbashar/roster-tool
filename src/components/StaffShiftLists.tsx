import Link from "next/link";
import { formatDateOnly, formatTimeRange } from "@/lib/time";
import { kioskCls, KioskNotice } from "@/components/KioskForm";

/**
 * Read-only list views for the staff "My shifts" and "Open shifts" screens on
 * both (dark) clock surfaces. These only render links (the mutating release/
 * claim/cancel actions are PIN-gated on the next screen), and a published roster
 * is already shareable, so listing shifts here discloses nothing new.
 */

type ShiftLineInput = {
  date: string;
  label: string;
  startTime: string;
  endTime: string;
};

const menuPill =
  "inline-flex items-center gap-1.5 rounded-[12px] border border-[#2A3344] bg-[#1C2433] px-3.5 py-2.5 text-[13.5px] font-semibold text-[#CBD5E1] hover:border-[#76b900] hover:text-white";

const MENU = [
  { mode: "leave", label: "Request leave", icon: "beach_access" },
  { mode: "myshifts", label: "My shifts", icon: "event" },
  { mode: "open", label: "Open shifts", icon: "swap_horiz" },
  { mode: "stock", label: "Stock check", icon: "inventory" },
] as const;

/** Links shown under the clock form: leave, my shifts, open shifts, stock. */
export function StaffShiftMenu({
  basePath,
  staffId,
}: {
  basePath: string;
  staffId: string;
}) {
  return (
    <nav
      className="mt-5 flex flex-wrap justify-center gap-2.5"
      aria-label="More"
    >
      {MENU.map((m) => (
        <Link
          key={m.mode}
          href={`${basePath}?staff=${staffId}&mode=${m.mode}`}
          className={menuPill}
        >
          <span className="material-symbols-rounded text-[17px] text-[#9CA3AF]">
            {m.icon}
          </span>
          {m.label}
        </Link>
      ))}
    </nav>
  );
}

/** Back navigation shown on the My shifts / Open shifts list screens. */
export function StaffShiftBackLinks({
  basePath,
  staffId,
}: {
  basePath: string;
  staffId: string;
}) {
  return (
    <nav className="mt-6 flex flex-wrap justify-center gap-4" aria-label="Back">
      <Link href={`${basePath}?staff=${staffId}`} className={kioskCls.link}>
        ← Back
      </Link>
      <Link
        href={`${basePath}?staff=${staffId}&mode=myshifts`}
        className={kioskCls.link}
      >
        My shifts
      </Link>
      <Link
        href={`${basePath}?staff=${staffId}&mode=open`}
        className={kioskCls.link}
      >
        Open shifts
      </Link>
    </nav>
  );
}

function shiftLine(s: ShiftLineInput): string {
  return `${formatDateOnly(s.date)} · ${s.label} · ${formatTimeRange(s.startTime, s.endTime)}`;
}

const rowCard =
  "flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#2A3344] bg-[#1C2433] px-4 py-3.5";

export type MyShift = ShiftLineInput & {
  shiftId: string;
  offerId: string | null;
  offerStatus: string | null;
  offeredByStaffId: string | null;
};

export function MyShiftsList({
  shifts,
  basePath,
  staffId,
}: {
  shifts: MyShift[];
  basePath: string;
  staffId: string;
}) {
  if (shifts.length === 0) {
    return (
      <KioskNotice>
        You have no upcoming shifts on a published roster.
      </KioskNotice>
    );
  }
  return (
    <ul className="space-y-2.5">
      {shifts.map((s) => {
        const ownOpenOffer =
          s.offerStatus === "open" && s.offeredByStaffId === staffId;
        return (
          <li key={s.shiftId}>
            <div className={rowCard}>
              <span className="font-medium text-white">{shiftLine(s)}</span>
              {s.offerStatus === "claimed" ? (
                <span className="rounded-[6px] bg-[#1D4ED8] px-2 py-0.5 text-xs font-semibold text-white">
                  Claimed — awaiting manager
                </span>
              ) : ownOpenOffer ? (
                <Link
                  href={`${basePath}?staff=${staffId}&mode=cancel&offer=${s.offerId}`}
                  className={kioskCls.link}
                >
                  Offered — cancel
                </Link>
              ) : s.offerStatus === "open" ? (
                <span className="text-[13.5px] text-[#9CA3AF]">Offered up</span>
              ) : (
                <Link
                  href={`${basePath}?staff=${staffId}&mode=release&shift=${s.shiftId}`}
                  className={kioskCls.link}
                >
                  Offer up
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export type OrgOffer = ShiftLineInput & {
  offerId: string;
  locationName: string;
};

/**
 * Open shifts at OTHER locations in the same business that this staff member can
 * cover (M29 Phase 3). Shown below the local "Open shifts" list; claiming routes
 * to the PIN-gated cross-location claim. The owner still approves the handover.
 */
export function OtherLocationOffers({
  offers,
  basePath,
  staffId,
}: {
  offers: OrgOffer[];
  basePath: string;
  staffId: string;
}) {
  if (offers.length === 0) return null;
  return (
    <div className="mt-7">
      <p className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#9CA3AF]">
        Cover at another location
      </p>
      <ul className="space-y-2.5">
        {offers.map((o) => (
          <li key={o.offerId}>
            <div className={rowCard}>
              <div>
                <p className="font-medium text-white">{shiftLine(o)}</p>
                <p className="flex items-center gap-1 text-[13px] text-[#9CA3AF]">
                  <span className="material-symbols-rounded text-[15px]">
                    storefront
                  </span>
                  {o.locationName}
                </p>
              </div>
              <Link
                href={`${basePath}?staff=${staffId}&mode=claimorg&offer=${o.offerId}`}
                className={kioskCls.link}
              >
                Claim
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type OpenOffer = ShiftLineInput & {
  offerId: string;
  offeredByStaffId: string | null;
  offeredByName: string | null;
};

export function OpenShiftsList({
  offers,
  basePath,
  staffId,
}: {
  offers: OpenOffer[];
  basePath: string;
  staffId: string;
}) {
  // Can't claim a shift you offered up yourself.
  const claimable = offers.filter((o) => o.offeredByStaffId !== staffId);
  if (claimable.length === 0) {
    return <KioskNotice>No open shifts to claim right now.</KioskNotice>;
  }
  return (
    <ul className="space-y-2.5">
      {claimable.map((o) => (
        <li key={o.offerId}>
          <div className={rowCard}>
            <div>
              <p className="font-medium text-white">{shiftLine(o)}</p>
              <p className="text-[13px] text-[#9CA3AF]">
                {o.offeredByName
                  ? `Offered by ${o.offeredByName}`
                  : "Open shift"}
              </p>
            </div>
            <Link
              href={`${basePath}?staff=${staffId}&mode=claim&offer=${o.offerId}`}
              className={kioskCls.link}
            >
              Claim
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
