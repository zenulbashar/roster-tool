import { ownerContext } from "@/lib/auth/context";
import { businessDateOf, formatDateOnly } from "@/lib/time";
import { loanStatus } from "@/lib/staff-loan";
import {
  PageHeader,
  Card,
  Badge,
  Avatar,
  EmptyState,
  Field,
  TextInput,
  Button,
  Banner,
} from "@/components/ui";
import {
  addPersonToLocationAction,
  removePersonFromLocationAction,
  createLoanAction,
  endLoanAction,
} from "./actions";

/**
 * Org People page (M29): the shared staff pool. Lists everyone across the org
 * and lets the owner place each person at any location (a `staff_location`
 * membership) — which is what makes them appear in that location's roster,
 * availability and kiosk. This is how staff are "shared" and lent between
 * locations. Phase 4 adds date-ranged **loans** (a time-boxed lend that
 * auto-expires). New people are still added on a location's Staff page.
 */
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ loaned?: string; loanError?: string }>;
}) {
  const { repo, org } = await ownerContext();
  const [people, locations, loans, loanMarkers, business] = await Promise.all([
    org.listPeople(),
    org.listLocations(),
    org.listLoans(),
    org.loansForMarkers(),
    repo.getBusiness(),
  ]);
  const multiLocation = locations.length > 1;
  const today = businessDateOf(new Date(), business?.timezone);
  const { loaned, loanError } = await searchParams;

  // Active (in-window) loan per person → "On loan to X" marker.
  const activeLoanByStaff = new Map<string, string>();
  for (const m of loanMarkers) {
    if (loanStatus(m.startDate, m.endDate, today) === "active") {
      activeLoanByStaff.set(m.staffMemberId, m.toName);
    }
  }

  return (
    <div>
      <PageHeader
        title="People"
        subtitle="Everyone across your locations. Add a person to a location to roster them there — that's how you share and lend staff between venues."
      />

      {loaned ? (
        <div className="mb-4">
          <Banner tone="success">Loan created.</Banner>
        </div>
      ) : null}
      {loanError ? (
        <div className="mb-4">
          <Banner tone="warn">
            {loanError === "home"
              ? "That person already works at that location."
              : loanError === "dates"
                ? "Check the dates — the end date must be on or after the start."
                : "Couldn't create that loan. Check the details and try again."}
          </Banner>
        </div>
      ) : null}

      {people.length === 0 ? (
        <Card>
          <EmptyState icon="group" title="No staff yet">
            Add your team on a location&rsquo;s Staff page, then place them at
            other locations here.
          </EmptyState>
        </Card>
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)]">
                  <th className="px-5 py-3 font-archivo text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
                    Person
                  </th>
                  <th className="px-5 py-3 font-archivo text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
                    Works at
                  </th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const memberOf = new Set(p.locationIds);
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-[var(--color-border-subtle)] last:border-0 align-top"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <Avatar name={p.name} colorKey={p.id} size={34} />
                          <div>
                            <p className="text-[14px] font-semibold text-[var(--color-text)]">
                              {p.name}
                              {!p.active ? (
                                <span className="ml-2 align-middle">
                                  <Badge tone="draft">Inactive</Badge>
                                </span>
                              ) : null}
                            </p>
                            <p className="text-[12.5px] text-[var(--color-text-muted)]">
                              {p.email}
                            </p>
                            {activeLoanByStaff.has(p.id) ? (
                              <p className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-[#B45309]">
                                <span className="material-symbols-rounded text-[14px]">
                                  sync_alt
                                </span>
                                On loan to {activeLoanByStaff.get(p.id)}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-2">
                          {locations.map((loc) => {
                            const isMember = memberOf.has(loc.id);
                            const isHome = loc.id === p.homeBusinessId;
                            if (isMember) {
                              return (
                                <LocationChip
                                  key={loc.id}
                                  name={loc.name}
                                  isHome={isHome}
                                  personId={p.id}
                                  businessId={loc.id}
                                />
                              );
                            }
                            return (
                              <form
                                key={loc.id}
                                action={addPersonToLocationAction}
                              >
                                <input
                                  type="hidden"
                                  name="staffMemberId"
                                  value={p.id}
                                />
                                <input
                                  type="hidden"
                                  name="businessId"
                                  value={loc.id}
                                />
                                <button
                                  type="submit"
                                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--color-line)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-button)] hover:text-[#13301F]"
                                >
                                  <span className="material-symbols-rounded text-[15px]">
                                    add
                                  </span>
                                  {loc.name}
                                </button>
                              </form>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!multiLocation ? (
        <p className="mt-4 text-[13px] text-[var(--color-text-muted)]">
          Add another location to start sharing staff between venues.
        </p>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card id="lend">
            <h2 className="mb-1 font-archivo text-[17px] font-bold text-[var(--color-text)]">
              Lend someone for a date range
            </h2>
            <p className="mb-4 text-[13px] text-[var(--color-text-secondary)]">
              They&rsquo;ll be rosterable at the other location for the dates
              you pick, then automatically drop off when the loan ends.
            </p>
            <form action={createLoanAction} className="grid gap-4">
              <Field label="Who">
                <select
                  name="staffMemberId"
                  required
                  className={selectCls}
                  defaultValue=""
                >
                  <option value="" disabled>
                    Choose a person
                  </option>
                  {people
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Lend to">
                <select
                  name="toBusinessId"
                  required
                  className={selectCls}
                  defaultValue=""
                >
                  <option value="" disabled>
                    Choose a location
                  </option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From">
                  <TextInput type="date" name="startDate" required />
                </Field>
                <Field label="To">
                  <TextInput type="date" name="endDate" required />
                </Field>
              </div>
              <Field label="Note (optional)">
                <TextInput
                  name="note"
                  maxLength={300}
                  placeholder="e.g. covering annual leave"
                />
              </Field>
              <div>
                <Button type="submit">Create loan</Button>
              </div>
            </form>
          </Card>

          <Card padded={false} id="loans">
            <div className="border-b border-[var(--color-border-subtle)] px-5 py-4">
              <h2 className="font-archivo text-[17px] font-bold text-[var(--color-text)]">
                Current &amp; upcoming loans
              </h2>
            </div>
            {loans.length === 0 ? (
              <EmptyState icon="sync_alt" title="No loans">
                Lend someone to another location and it&rsquo;ll show here until
                it ends.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-[var(--color-border-subtle)]">
                {loans.map((loan) => {
                  const status = loanStatus(
                    loan.startDate,
                    loan.endDate,
                    today,
                  );
                  return (
                    <li
                      key={loan.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                    >
                      <div>
                        <p className="text-[14px] font-semibold text-[var(--color-text)]">
                          {loan.staffName}{" "}
                          <span className="font-normal text-[var(--color-text-muted)]">
                            → {loan.toName}
                          </span>
                        </p>
                        <p className="text-[12.5px] text-[var(--color-text-muted)]">
                          {formatDateOnly(loan.startDate)} –{" "}
                          {formatDateOnly(loan.endDate)}
                          {loan.note ? ` · ${loan.note}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <Badge tone={status === "active" ? "success" : "info"}>
                          {status === "active" ? "On loan" : "Upcoming"}
                        </Badge>
                        <form action={endLoanAction}>
                          <input type="hidden" name="loanId" value={loan.id} />
                          <Button type="submit" variant="secondary">
                            End
                          </Button>
                        </form>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

const selectCls =
  "block w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-[14px] py-[11px] text-[14.5px] text-[var(--color-ink)] outline-none focus:border-[var(--color-button)] focus:ring-[3px] focus:ring-[rgba(19,48,31,0.18)]";

/** A location the person is a member of: green chip; removable unless it's home. */
function LocationChip({
  name,
  isHome,
  personId,
  businessId,
}: {
  name: string;
  isHome: boolean;
  personId: string;
  businessId: string;
}) {
  if (isHome) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[#BBF7D0] bg-[#ECFDF3] px-2.5 py-1 text-[12px] font-semibold text-[#15803D]">
        <span className="material-symbols-rounded text-[15px]">home_pin</span>
        {name}
      </span>
    );
  }
  return (
    <form action={removePersonFromLocationAction}>
      <input type="hidden" name="staffMemberId" value={personId} />
      <input type="hidden" name="businessId" value={businessId} />
      <button
        type="submit"
        title={`Remove from ${name}`}
        className="inline-flex items-center gap-1 rounded-full border border-[#BBF7D0] bg-[#ECFDF3] px-2.5 py-1 text-[12px] font-semibold text-[#15803D] transition-colors hover:border-[#FECACA] hover:bg-[#FEECEC] hover:text-[#B91C1C]"
      >
        <span className="material-symbols-rounded text-[15px]">check</span>
        {name}
      </button>
    </form>
  );
}
