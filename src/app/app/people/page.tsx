import { requireOwner } from "@/lib/auth/context";
import { createOrgRepo } from "@/lib/tenant/org-repository";
import { PageHeader, Card, Badge, Avatar, EmptyState } from "@/components/ui";
import {
  addPersonToLocationAction,
  removePersonFromLocationAction,
} from "./actions";

/**
 * Org People page (M29): the shared staff pool. Lists everyone across the org
 * and lets the owner place each person at any location (a `staff_location`
 * membership) — which is what makes them appear in that location's roster,
 * availability and kiosk. This is how staff are "shared" and lent between
 * locations. New people are still added on a location's Staff page.
 */
export default async function PeoplePage() {
  const { orgId } = await requireOwner();
  const org = createOrgRepo(orgId);
  const [people, locations] = await Promise.all([
    org.listPeople(),
    org.listLocations(),
  ]);
  const multiLocation = locations.length > 1;

  return (
    <div>
      <PageHeader
        title="People"
        subtitle="Everyone across your locations. Add a person to a location to roster them there — that's how you share and lend staff between venues."
      />

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
                                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--color-line)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-button)] hover:text-[#3F6212]"
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
      ) : null}
    </div>
  );
}

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
