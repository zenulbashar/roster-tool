import Link from "next/link";
import { Icon } from "@/components/ui";

/**
 * Public landing shown to a bookkeeper after the delegated Xero connect (they
 * have no owner session). Success: the org is connected but INERT until the
 * owner confirms it. Error: the invite link was invalid/expired/already used.
 */
export default async function XeroConnectedPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const ok = Boolean(sp.connected) && !sp.error;

  return (
    <main
      id="main"
      className="flex min-h-screen items-center justify-center px-5 py-10"
      style={{
        backgroundImage:
          "radial-gradient(circle at 50% 0, #F4F8E9, #F9FAFB 60%)",
      }}
    >
      <div className="w-full max-w-[460px]">
        <Link
          href="/"
          className="mb-[26px] flex items-center justify-center gap-2.5"
        >
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#111827]"
          >
            <span className="material-symbols-rounded text-[20px] text-[#76b900]">
              grid_view
            </span>
          </span>
          <span className="font-archivo text-[22px] font-extrabold tracking-[0.05em] text-[#111827]">
            ROSTER
          </span>
        </Link>

        <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-[28px] text-center shadow-[0_1px_3px_rgba(17,24,39,.05)]">
          <span
            aria-hidden="true"
            className={`mx-auto mb-[16px] flex h-[52px] w-[52px] items-center justify-center rounded-full ${
              ok ? "bg-[#ECFDF3]" : "bg-[#FEECEC]"
            }`}
          >
            <Icon
              name={ok ? "check_circle" : "error"}
              fill
              className={`text-[30px] ${ok ? "text-[#16A34A]" : "text-[#B91C1C]"}`}
            />
          </span>
          {ok ? (
            <>
              <h1 className="font-archivo text-[22px] font-extrabold tracking-[-0.02em] text-[#111827]">
                Xero connected
              </h1>
              <p className="mt-[10px] text-[13.5px] leading-[1.6] text-[#6B7280]">
                Thanks — the Xero organisation is now linked. Nothing is pushed
                yet: the business owner will{" "}
                <strong>confirm the organisation</strong> in Roster before any
                approved hours are sent as draft timesheets. You can close this
                tab.
              </p>
            </>
          ) : (
            <>
              <h1 className="font-archivo text-[22px] font-extrabold tracking-[-0.02em] text-[#111827]">
                This link didn’t work
              </h1>
              <p className="mt-[10px] text-[13.5px] leading-[1.6] text-[#6B7280]">
                The connect link is invalid, has expired, or was already used.
                Ask the business owner to send you a fresh invite from their
                Roster settings.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
