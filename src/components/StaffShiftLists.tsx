import Link from "next/link";
import { Card } from "@/components/ui";
import { formatDateOnly, formatTimeOnly } from "@/lib/time";

/**
 * Read-only list views for the staff "My shifts" and "Open shifts" screens on
 * both clock surfaces. These only render links (the mutating release/claim/
 * cancel actions are PIN-gated on the next screen), and a published roster is
 * already shareable, so listing shifts here discloses nothing new.
 */

type ShiftLineInput = {
  date: string;
  label: string;
  startTime: string;
  endTime: string;
};

const menuLink =
  "text-sm font-medium text-[var(--color-brand)] underline underline-offset-2";

/** Links shown under the clock form: leave, my shifts, open shifts. */
export function StaffShiftMenu({
  basePath,
  staffId,
}: {
  basePath: string;
  staffId: string;
}) {
  return (
    <nav className="mt-4 flex flex-wrap justify-center gap-4" aria-label="More">
      <Link
        href={`${basePath}?staff=${staffId}&mode=leave`}
        className={menuLink}
      >
        Request leave
      </Link>
      <Link
        href={`${basePath}?staff=${staffId}&mode=myshifts`}
        className={menuLink}
      >
        My shifts
      </Link>
      <Link
        href={`${basePath}?staff=${staffId}&mode=open`}
        className={menuLink}
      >
        Open shifts
      </Link>
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
      <Link href={`${basePath}?staff=${staffId}`} className={menuLink}>
        ← Back
      </Link>
      <Link
        href={`${basePath}?staff=${staffId}&mode=myshifts`}
        className={menuLink}
      >
        My shifts
      </Link>
      <Link
        href={`${basePath}?staff=${staffId}&mode=open`}
        className={menuLink}
      >
        Open shifts
      </Link>
    </nav>
  );
}

function shiftLine(s: ShiftLineInput): string {
  return `${formatDateOnly(s.date)} · ${s.label} · ${formatTimeOnly(s.startTime)} – ${formatTimeOnly(s.endTime)}`;
}

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
      <Card className="text-center text-[var(--color-muted)]">
        You have no upcoming shifts on a published roster.
      </Card>
    );
  }
  return (
    <ul className="space-y-2">
      {shifts.map((s) => {
        const ownOpenOffer =
          s.offerStatus === "open" && s.offeredByStaffId === staffId;
        return (
          <li key={s.shiftId}>
            <Card className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="font-medium">{shiftLine(s)}</span>
              {s.offerStatus === "claimed" ? (
                <span className="rounded bg-[var(--color-brand)] px-2 py-0.5 text-xs font-semibold text-[var(--color-brand-ink)]">
                  Claimed — awaiting manager
                </span>
              ) : ownOpenOffer ? (
                <Link
                  href={`${basePath}?staff=${staffId}&mode=cancel&offer=${s.offerId}`}
                  className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                >
                  Offered — cancel
                </Link>
              ) : s.offerStatus === "open" ? (
                <span className="text-sm text-[var(--color-muted)]">
                  Offered up
                </span>
              ) : (
                <Link
                  href={`${basePath}?staff=${staffId}&mode=release&shift=${s.shiftId}`}
                  className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                >
                  Offer up
                </Link>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
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
    return (
      <Card className="text-center text-[var(--color-muted)]">
        No open shifts to claim right now.
      </Card>
    );
  }
  return (
    <ul className="space-y-2">
      {claimable.map((o) => (
        <li key={o.offerId}>
          <Card className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-medium">{shiftLine(o)}</p>
              <p className="text-sm text-[var(--color-muted)]">
                {o.offeredByName
                  ? `Offered by ${o.offeredByName}`
                  : "Open shift"}
              </p>
            </div>
            <Link
              href={`${basePath}?staff=${staffId}&mode=claim&offer=${o.offerId}`}
              className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
            >
              Claim
            </Link>
          </Card>
        </li>
      ))}
    </ul>
  );
}
