import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared dark-surface styles + tiny presentational pieces for the kiosk /
 * personal-phone sub-flows (leave request, stock check, release/claim/cancel,
 * my-shifts, open-shifts). These render on the dark clock chrome (#0E1320), so
 * everything is light-on-dark with the green primary. Presentational only.
 */

export const kioskCls = {
  card: "w-full rounded-[18px] border border-[#2A3344] bg-[#1C2433] p-6",
  heading: "font-archivo text-[22px] font-extrabold text-white",
  sub: "mt-1 text-[14px] text-[#9CA3AF]",
  label: "mb-1.5 block text-[13px] font-semibold text-[#CBD5E1]",
  smallLabel: "mb-1 block text-[12px] font-semibold text-[#9CA3AF]",
  input:
    "block w-full rounded-[12px] border border-[#2A3344] bg-[#0E1320] px-4 py-3 text-[15px] text-white outline-none placeholder:text-[#4B5563] focus:border-[#76b900]",
  pin: "block w-full rounded-[14px] border border-[#2A3344] bg-[#0E1320] px-4 py-3.5 text-center font-archivo text-3xl tracking-[0.5em] text-white outline-none placeholder:text-[#4B5563] focus:border-[#76b900]",
  primary:
    "flex-1 rounded-[14px] bg-[#76b900] px-6 py-3.5 font-archivo text-[15px] font-bold text-[#111827] hover:bg-[#6aa600] disabled:opacity-60",
  cancel:
    "inline-flex min-h-12 items-center justify-center rounded-[14px] border border-[#2A3344] px-5 py-3 text-[15px] font-semibold text-[#CBD5E1] hover:bg-[#222C3D]",
  muted: "text-[#9CA3AF]",
  link: "text-[14px] font-semibold text-[#A6C64D] hover:underline",
} as const;

/** Dark success panel: green tick, message, Done link back. */
export function KioskSuccess({
  message,
  backHref,
}: {
  message: ReactNode;
  backHref: string;
}) {
  return (
    <div className="mt-2 w-full rounded-[22px] border border-[#166534] bg-[#14532D] p-9 text-center">
      <div className="mx-auto mb-[18px] flex h-[64px] w-[64px] items-center justify-center rounded-full bg-[#76b900]">
        <span className="material-symbols-rounded fill text-[38px] text-[#111827]">
          check
        </span>
      </div>
      <p className="font-archivo text-[20px] font-extrabold text-white">
        {message}
      </p>
      <Link
        href={backHref}
        className="mt-6 inline-flex min-h-12 items-center justify-center rounded-[12px] bg-white px-8 py-3 font-archivo text-[15px] font-bold text-[#111827]"
      >
        Done
      </Link>
    </div>
  );
}

/** Dark empty/notice panel (no items, no shifts, etc.). */
export function KioskNotice({ children }: { children: ReactNode }) {
  return (
    <div className="w-full rounded-[16px] border border-[#2A3344] bg-[#1C2433] p-6 text-center text-[#9CA3AF]">
      {children}
    </div>
  );
}
