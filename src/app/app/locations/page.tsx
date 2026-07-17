import { requireOwner } from "@/lib/auth/context";
import { createOrgRepo } from "@/lib/tenant/org-repository";
import { AU_TIMEZONES } from "@/lib/timezones";
import {
  PageHeader,
  Card,
  Field,
  TextInput,
  Button,
  Badge,
  Banner,
} from "@/components/ui";
import { switchLocationAction, addLocationAction } from "./actions";

/**
 * Org-level Locations page (M29): list every location in the owner's org,
 * showing which is active and letting them switch, plus an "Add location" form.
 * All reads/writes are org-scoped via the session-derived org id.
 */
export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { orgId, businessId } = await requireOwner();
  const org = createOrgRepo(orgId);
  const locations = await org.listLocations();
  const { error } = await searchParams;

  return (
    <div>
      <PageHeader
        title="Locations"
        subtitle="Each location has its own rosters, shifts and timesheets. Your staff are shared across the whole business."
      />

      {error ? (
        <div className="mb-4">
          <Banner tone="warn">
            Please enter a location name and pick a timezone.
          </Banner>
        </div>
      ) : null}

      <Card padded={false} className="mb-6">
        <ul className="divide-y divide-[var(--color-border-subtle)]">
          {locations.map((loc) => {
            const isActive = loc.id === businessId;
            return (
              <li
                key={loc.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="material-symbols-rounded text-[22px] text-[var(--color-text-muted)]"
                  >
                    storefront
                  </span>
                  <div>
                    <p className="text-[14.5px] font-semibold text-[var(--color-text)]">
                      {loc.name}
                    </p>
                    <p className="text-[12.5px] text-[var(--color-text-muted)]">
                      {loc.timezone}
                    </p>
                  </div>
                </div>
                {isActive ? (
                  <Badge tone="success">Active</Badge>
                ) : (
                  <form action={switchLocationAction}>
                    <input type="hidden" name="businessId" value={loc.id} />
                    <Button type="submit" variant="secondary">
                      Switch to this location
                    </Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card id="add">
        <h2 className="mb-1 font-archivo text-[17px] font-bold text-[var(--color-text)]">
          Add a location
        </h2>
        <p className="mb-4 text-[13px] text-[var(--color-text-secondary)]">
          Create another venue under your business. You'll switch to it so you
          can set up its shift types and rosters.
        </p>
        <form action={addLocationAction} className="grid gap-4 sm:max-w-md">
          <Field label="Location name">
            <TextInput
              name="name"
              required
              maxLength={120}
              placeholder="e.g. Airport Kiosk"
            />
          </Field>
          <Field label="Timezone">
            <select
              name="timezone"
              defaultValue="Australia/Sydney"
              className="block w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-[14px] py-[11px] text-[14.5px] text-[var(--color-ink)] outline-none focus:border-[var(--color-button)] focus:ring-[3px] focus:ring-[rgba(19,48,31,0.18)]"
            >
              {AU_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <Button type="submit">Add location</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
