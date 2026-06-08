import Link from "next/link";
import { cookies } from "next/headers";
import { createTenantRepo } from "@/lib/tenant/repository";
import { resolveKioskBusiness } from "@/lib/tenant/kiosk-access";
import { KIOSK_COOKIE } from "@/lib/kiosk-cookie";
import { Card } from "@/components/ui";
import { KioskClockForm } from "@/components/KioskClockForm";

export const dynamic = "force-dynamic";

export default async function KioskPage({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string }>;
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
  const { staff: selectedId } = await searchParams;
  const selected = selectedId
    ? staff.find((s) => s.id === selectedId)
    : undefined;

  if (selected) {
    const open = await repo.getOpenEntry(selected.id);
    return (
      <KioskClockForm
        staffId={selected.id}
        staffName={selected.name}
        currentlyIn={open !== null}
        requirePhoto={business.requireClockInPhoto}
      />
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
