import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth/context";
import { signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { OwnerNav } from "@/components/OwnerNav";

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { businessId } = await requireOwner();
  const [business] = await db
    .select({ name: businesses.name })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <div className="min-h-screen">
      <header className="bg-[var(--color-header-bg)] text-[var(--color-header-ink)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <Link
              href="/app"
              className="text-lg font-extrabold tracking-tight text-[var(--color-header-ink)]"
            >
              Zale<span className="text-[var(--color-accent)]">IT</span>
            </Link>
            {business?.name ? (
              <span className="truncate text-sm text-[var(--color-header-muted)]">
                {business.name}
              </span>
            ) : null}
          </div>
          <form action={doSignOut}>
            <button
              type="submit"
              className="rounded-md px-2 py-1 text-sm font-medium text-[var(--color-header-muted)] underline underline-offset-2 hover:text-[var(--color-header-ink)]"
            >
              Sign out
            </button>
          </form>
        </div>
        <OwnerNav />
      </header>
      <main id="main" className="mx-auto max-w-3xl px-5 py-8">
        {children}
      </main>
    </div>
  );
}
