import Link from "next/link";
import { requireOwner } from "@/lib/auth/context";
import { signOut } from "@/lib/auth";
import { OwnerNav } from "@/components/OwnerNav";

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOwner();

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <div className="min-h-screen">
      <header className="bg-[var(--color-header-bg)] text-[var(--color-header-ink)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3">
          <Link
            href="/app"
            className="text-lg font-extrabold tracking-tight text-[var(--color-header-ink)]"
          >
            Zale<span className="text-[var(--color-accent)]">IT</span>
          </Link>
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
