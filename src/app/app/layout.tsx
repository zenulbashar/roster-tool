import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth/context";
import { signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";

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
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/app" className="font-bold tracking-tight">
            {business?.name ?? "Roster"}
          </Link>
          <form action={doSignOut}>
            <button
              type="submit"
              className="text-sm font-medium text-[var(--color-muted)] underline underline-offset-2 hover:text-[var(--color-ink)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-5 py-8">
        {children}
      </main>
    </div>
  );
}
