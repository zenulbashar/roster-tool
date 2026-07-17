import { exitImpersonation } from "@/app/admin/actions";

/**
 * The persistent impersonation banner (M37) — the ever-present red framing that
 * reminds an admin they're acting inside a client's LIVE account. Fixed at the
 * top (52px) above all chrome, with a 45° stripe overlay; "Exit to admin"
 * clears the impersonation cookie and returns to the console. Sits OUTSIDE
 * `<main>` so the write-confirm guard never intercepts its own exit form.
 */
export function ImpersonationBanner({ venueName }: { venueName: string }) {
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[60] flex h-[52px] items-center gap-3 px-4 text-white shadow-[0_3px_14px_rgba(185,28,28,0.4)]"
      style={{
        backgroundColor: "#B91C1C",
        backgroundImage:
          "repeating-linear-gradient(45deg, rgba(0,0,0,0.06) 0, rgba(0,0,0,0.06) 7px, transparent 7px, transparent 14px)",
      }}
    >
      <span
        aria-hidden="true"
        className="material-symbols-rounded fill text-[22px]"
      >
        warning
      </span>
      <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
        Acting as {venueName} — changes save to their{" "}
        <span className="font-bold underline">LIVE account</span>.
      </p>
      <form action={exitImpersonation} data-imp-allow>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-[9px] bg-white px-[13px] py-[8px] text-[12.5px] font-bold text-[#B91C1C] transition-colors hover:bg-[#FEECEC]"
        >
          <span
            aria-hidden="true"
            className="material-symbols-rounded text-[17px]"
          >
            logout
          </span>
          Exit to admin
        </button>
      </form>
    </div>
  );
}
