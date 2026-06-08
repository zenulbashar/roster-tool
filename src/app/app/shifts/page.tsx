import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { enqueueShiftOfferDecision } from "@/lib/jobs/boss";
import { timesOverlap } from "@/lib/shift-offer";
import { businessDateOf, formatDateOnly, formatTimeOnly } from "@/lib/time";
import { Banner, Button, Card, PageHeader } from "@/components/ui";

const PATH = "/app/shifts";

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    approved?: string;
    denied?: string;
    withdrawn?: string;
    posted?: string;
  }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const business = await repo.getBusiness();
  const today = businessDateOf(new Date(), business?.timezone);

  const [claims, openOffers, unassigned] = await Promise.all([
    repo.listPendingClaims(),
    repo.listOpenOffers(),
    repo.listUnassignedPublishedShifts(today),
  ]);

  // Compute non-blocking conflict flags for each pending claim: does the
  // claimer have approved leave on the day, or another shift that overlaps?
  const claimsWithFlags = await Promise.all(
    claims.map(async (c) => {
      if (!c.claimedByStaffId) {
        return { ...c, onLeave: false, overlap: false };
      }
      const [onLeave, sameDay] = await Promise.all([
        repo.hasApprovedLeaveOn(c.claimedByStaffId, c.date),
        repo.confirmedShiftsForStaffOnDate(
          c.claimedByStaffId,
          c.date,
          c.shiftId,
        ),
      ]);
      const overlap = sameDay.some((x) =>
        timesOverlap(c.startTime, c.endTime, x.startTime, x.endTime),
      );
      return { ...c, onLeave, overlap };
    }),
  );

  async function approveClaim(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const offerId = String(formData.get("offerId"));
    const res = await repo.approveOffer(offerId);
    if (!res.ok) {
      redirect(`${PATH}?error=${encodeURIComponent(res.reason)}`);
    }
    await enqueueShiftOfferDecision({ shiftOfferId: offerId });
    revalidatePath(PATH);
    redirect(`${PATH}?approved=1`);
  }

  async function denyClaim(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const offerId = String(formData.get("offerId"));
    await repo.denyOffer(offerId);
    revalidatePath(PATH);
    redirect(`${PATH}?denied=1`);
  }

  async function withdraw(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const offerId = String(formData.get("offerId"));
    await repo.withdrawOffer(offerId);
    revalidatePath(PATH);
    redirect(`${PATH}?withdrawn=1`);
  }

  async function postOpen(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const shiftId = String(formData.get("shiftId"));
    const res = await repo.postOpenShift(shiftId);
    if (!res.ok) {
      redirect(`${PATH}?error=${encodeURIComponent(res.reason)}`);
    }
    revalidatePath(PATH);
    redirect(`${PATH}?posted=1`);
  }

  function shiftLine(c: {
    date: string;
    label: string;
    startTime: string;
    endTime: string;
  }) {
    return `${formatDateOnly(c.date)} · ${c.label} · ${formatTimeOnly(c.startTime)} – ${formatTimeOnly(c.endTime)}`;
  }

  return (
    <>
      <PageHeader
        title="Shifts"
        subtitle="Shift swaps and open shifts. Staff offer up a shift or claim an open one; you approve the handover. The original person stays on until you approve a replacement."
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.approved ? (
        <Banner tone="success">
          Claim approved — the shift was handed over.
        </Banner>
      ) : null}
      {sp.denied ? <Banner tone="success">Claim denied.</Banner> : null}
      {sp.withdrawn ? <Banner tone="success">Offer withdrawn.</Banner> : null}
      {sp.posted ? (
        <Banner tone="success">Shift opened for claims.</Banner>
      ) : null}

      <section className="mt-4" aria-label="Pending claims">
        <h2 className="mb-3 text-lg font-semibold">
          Claims to review ({claimsWithFlags.length})
        </h2>
        {claimsWithFlags.length === 0 ? (
          <p className="text-[var(--color-muted)]">
            No claims waiting. When someone claims an open shift, it shows up
            here for you to approve.
          </p>
        ) : (
          <ul className="space-y-2">
            {claimsWithFlags.map((c) => (
              <li key={c.offerId}>
                <Card className="flex flex-wrap items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-semibold">{shiftLine(c)}</p>
                    <p className="text-sm text-[var(--color-muted)]">
                      {c.offeredByName
                        ? `Offered by ${c.offeredByName}`
                        : "Open shift"}{" "}
                      → claimed by{" "}
                      <span className="font-medium text-[var(--color-ink)]">
                        {c.claimedByName}
                      </span>
                    </p>
                    {c.onLeave || c.overlap ? (
                      <p className="mt-1 flex flex-wrap gap-2">
                        {c.onLeave ? (
                          <span className="rounded bg-[var(--color-warn)] px-1.5 py-0.5 text-[11px] font-semibold text-white">
                            On approved leave that day
                          </span>
                        ) : null}
                        {c.overlap ? (
                          <span className="rounded bg-[var(--color-warn)] px-1.5 py-0.5 text-[11px] font-semibold text-white">
                            Already on another shift that day
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <form action={approveClaim}>
                      <input type="hidden" name="offerId" value={c.offerId} />
                      <Button type="submit">Approve</Button>
                    </form>
                    <form action={denyClaim}>
                      <input type="hidden" name="offerId" value={c.offerId} />
                      <Button type="submit" variant="secondary">
                        Deny
                      </Button>
                    </form>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8" aria-label="Open offers">
        <h2 className="mb-3 text-lg font-semibold">
          Open shifts waiting for a claim ({openOffers.length})
        </h2>
        {openOffers.length === 0 ? (
          <p className="text-[var(--color-muted)]">Nothing open right now.</p>
        ) : (
          <ul className="space-y-2">
            {openOffers.map((o) => (
              <li key={o.offerId}>
                <Card className="flex flex-wrap items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-semibold">{shiftLine(o)}</p>
                    <p className="text-sm text-[var(--color-muted)]">
                      {o.offeredByName
                        ? `Offered by ${o.offeredByName}`
                        : "Open shift (posted by you)"}
                    </p>
                  </div>
                  <form action={withdraw}>
                    <input type="hidden" name="offerId" value={o.offerId} />
                    <button
                      type="submit"
                      className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                    >
                      Withdraw
                    </button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card className="mt-8">
        <h2 className="text-lg font-semibold">Open up an empty shift</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Make an unfilled shift on a published roster claimable. Staff can
          claim it from their phone or the kiosk; you approve who gets it.
        </p>
        {unassigned.length === 0 ? (
          <p className="mt-3 text-[var(--color-muted)]">
            No unfilled shifts on published rosters.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {unassigned.map((u) => (
              <li
                key={u.shiftId}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <span className="text-sm">{shiftLine(u)}</span>
                <form action={postOpen}>
                  <input type="hidden" name="shiftId" value={u.shiftId} />
                  <Button type="submit" variant="secondary">
                    Make claimable
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
