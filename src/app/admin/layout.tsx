import Link from "next/link";
import { requireAdmin } from "@/lib/admin/context";
import { AdminNav } from "@/components/admin/AdminNav";
import { Avatar } from "@/components/ui";

/**
 * Zale IT admin console chrome (M37). A dedicated INDIGO top bar (bg #1E1B4B),
 * visually distinct from the owner area (dark #111827 / Leaf) and the tenant
 * surfaces, so an operator is never in doubt they're in the vendor back-office.
 * requireAdmin() gates the whole subtree: non-admins 404, signed-out → sign-in.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <header className="sticky top-0 z-50 bg-[#1E1B4B] shadow-[0_1px_0_#312E81]">
        <div className="mx-auto flex h-[60px] max-w-[1340px] items-center gap-0 px-5">
          <Link
            href="/admin/clients"
            className="mr-2 flex items-center gap-2.5"
            aria-label="Zale IT admin home"
          >
            <span
              aria-hidden="true"
              className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-[#312E81] text-[#A5B4FC]"
            >
              <span className="material-symbols-rounded text-[17px]">
                shield_person
              </span>
            </span>
            <span className="font-archivo text-[18px] font-extrabold tracking-[0.05em] text-[#A5B4FC]">
              ROSTER
            </span>
            <span className="font-archivo rounded-[6px] border border-[#4338CA] bg-[#312E81] px-[7px] py-[2px] text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#C7D2FE]">
              Admin
            </span>
          </Link>
          <span
            className="ml-2 hidden border-l border-[#312E81] pl-3 text-[12.5px] text-[#9CA0C4] sm:inline"
            aria-hidden="true"
          >
            Zale IT · Platform operations
          </span>

          <AdminNav />

          <div className="flex-1" />

          <div className="flex items-center gap-2.5">
            <span className="hidden text-right text-[12.5px] font-semibold text-[#C7D2FE] sm:block">
              {admin.name}
              <span className="block text-[11px] font-normal text-[#9CA0C4]">
                Zale IT
              </span>
            </span>
            <Avatar name={admin.name} size={34} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1340px] px-[30px] pb-20 pt-[26px] max-sm:px-4">
        {children}
      </main>
    </div>
  );
}
