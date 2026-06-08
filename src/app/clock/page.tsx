import Link from "next/link";
import { cookies } from "next/headers";
import { createTenantRepo } from "@/lib/tenant/repository";
import { resolvePersonalClockBusiness } from "@/lib/tenant/personal-clock-access";
import { PERSONAL_CLOCK_COOKIE } from "@/lib/kiosk-cookie";
import { Banner, Card } from "@/components/ui";
import { PersonalClockForm } from "@/components/PersonalClockForm";

export const dynamic = "force-dynamic";

export default async function PersonalClockPage({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string }>;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(PERSONAL_CLOCK_COOKIE)?.value ?? "";
  const business = await resolvePersonalClockBusiness(token);

  if (!business) {
    return (
      <Card className="mt-8 text-center">
        <h1 className="text-xl font-bold">Clock-in link not active</h1>
        <p className="mt-2 text-[var(--color-muted)]">
          This link is no longer active. Ask your manager for the current phone
          clock-in link.
        </p>
      </Card>
    );
  }

  const locationConfigured =
    business.latitude !== null && business.longitude !== null;

  const repo = createTenantRepo(business.businessId);
  const staff = await repo.listActiveStaffForKiosk();
  const { staff: selectedId } = await searchParams;
  const selected = selectedId
    ? staff.find((s) => s.id === selectedId)
    : undefined;

  if (selected) {
    const open = await repo.getOpenEntry(selected.id);
    return (
      <PersonalClockForm
        staffId={selected.id}
        staffName={selected.name}
        currentlyIn={open !== null}
        locationConfigured={locationConfigured}
      />
    );
  }

  return (
    <>
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold">{business.name}</h1>
        <p className="mt-1 text-[var(--color-muted)]">
          Clock in or out from your phone. Tap your name.
        </p>
      </header>
      {!locationConfigured ? (
        <div className="mb-4">
          <Banner tone="warn">
            Phone clock-in isn&apos;t set up yet — ask your manager to set the
            shop location.
          </Banner>
        </div>
      ) : null}
      {staff.length === 0 ? (
        <Card className="text-center text-[var(--color-muted)]">
          No staff yet. Your manager can add team members and PINs.
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {staff.map((s) => (
            <li key={s.id}>
              <Link
                href={`/clock?staff=${s.id}`}
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
