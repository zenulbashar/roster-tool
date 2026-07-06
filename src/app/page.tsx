import Link from "next/link";

/**
 * Marketing landing page — recreated from the design handoff (dark hero → white
 * body → green pricing band → dark footer). Static; every CTA routes to the
 * passwordless sign-in. The product "screenshot" is a small static roster
 * mockup (decorative), matching the design's browser-chrome card.
 */

export const metadata = {
  title: "Roster — your whole week, sorted in minutes",
  description:
    "Rostering built for Australian hospitality. Build the week, track clock-ins, manage leave and stock — one flat monthly fee, no aggregator cut.",
};

const BrandMark = ({ size = 28 }: { size?: number }) => (
  <span className="flex items-center gap-2.5">
    <span
      aria-hidden="true"
      className="flex items-center justify-center rounded-[8px] bg-[#76b900] text-[#111827]"
      style={{ width: size, height: size }}
    >
      <span
        className="material-symbols-rounded"
        style={{ fontSize: Math.round(size * 0.64) }}
      >
        grid_view
      </span>
    </span>
    <span className="font-archivo text-[19px] font-extrabold tracking-[0.05em] text-[#76b900]">
      ROSTER
    </span>
  </span>
);

const FEATURES = [
  { icon: "grid_view", title: "Schedule", body: "Build the week in minutes" },
  { icon: "fingerprint", title: "Attendance", body: "PIN & GPS clock-in" },
  { icon: "beach_access", title: "Leave", body: "Approve in one tap" },
  { icon: "inventory_2", title: "Inventory", body: "Stock checks & orders" },
  {
    icon: "monitoring",
    title: "Analytics",
    body: "Hours & labour at a glance",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Add your team",
    body: "Name, email, pay rate. Send them a sign-in link — done in two minutes.",
  },
  {
    n: "02",
    title: "Build your roster",
    body: "Drag shifts onto the week, or draft from last week. See availability as you go.",
  },
  {
    n: "03",
    title: "Publish & go",
    body: "Staff get their shifts on their phone. They clock in by PIN. You get your night back.",
  },
];

// Decorative mini-roster data for the hero mockup (matches the design colours).
const MOCK_DAYS = ["Mon 23", "Tue 24", "Wed 25", "Thu 26", "Fri 27"];
const SHIFT = {
  m: { bg: "#F4F8E9", bar: "#76b900", label: "#3F6212", time: "#5A7D17" },
  a: { bg: "#F2EEFB", bar: "#7C5CBF", label: "#5B43A6", time: "#6E57B8" },
  c: { bg: "#EEF1F5", bar: "#1E293B", label: "#1E293B", time: "#566476" },
} as const;
type Cell = { k: keyof typeof SHIFT; l: string; t: string } | null;
const MOCK_ROWS: {
  name: string;
  color: string;
  cells: Cell[];
}[] = [
  {
    name: "Sarah H.",
    color: "#C2683B",
    cells: [
      { k: "m", l: "Morning", t: "8–2" },
      { k: "m", l: "Morning", t: "8–2" },
      null,
      { k: "m", l: "Morning", t: "8–2" },
      { k: "m", l: "Morning", t: "8–2" },
    ],
  },
  {
    name: "Jake T.",
    color: "#5B6B7B",
    cells: [
      { k: "a", l: "Arvo", t: "2–10" },
      { k: "a", l: "Arvo", t: "2–10" },
      { k: "a", l: "Arvo", t: "2–10" },
      null,
      { k: "c", l: "Close", t: "5–11" },
    ],
  },
  {
    name: "Aisha K.",
    color: "#8E5A9E",
    cells: [
      null,
      { k: "a", l: "Arvo", t: "4–10" },
      { k: "a", l: "Arvo", t: "4–10" },
      { k: "a", l: "Arvo", t: "4–10" },
      { k: "a", l: "Arvo", t: "4–10" },
    ],
  },
  {
    name: "Tom N.",
    color: "#2F7D6B",
    cells: [
      { k: "c", l: "Close", t: "5–11" },
      { k: "c", l: "Close", t: "5–11" },
      null,
      { k: "c", l: "Close", t: "5–11" },
      { k: "a", l: "Arvo", t: "2–10" },
    ],
  },
];

export default function HomePage() {
  return (
    <main id="main">
      {/* ---- Dark hero ---- */}
      <div className="bg-[#111827]">
        <div className="mx-auto max-w-[1180px] px-7">
          <div className="flex h-[72px] items-center gap-2.5">
            <BrandMark />
            <div className="flex-1" />
            <a
              href="#features"
              className="mr-[22px] hidden text-[13.5px] font-semibold text-[#D1D5DB] hover:text-white sm:inline"
            >
              Features
            </a>
            <a
              href="#pricing"
              className="mr-[22px] hidden text-[13.5px] font-semibold text-[#D1D5DB] hover:text-white sm:inline"
            >
              Pricing
            </a>
            <Link
              href="/sign-in"
              className="mr-3.5 text-[13.5px] font-semibold text-white hover:text-[#76b900]"
            >
              Sign in
            </Link>
            <Link
              href="/sign-in"
              className="rounded-[9px] bg-[#76b900] px-4 py-2.5 font-archivo text-[13.5px] font-bold text-[#111827] hover:bg-[#6aa600]"
            >
              Start free
            </Link>
          </div>

          <div className="px-2 pb-[18px] pt-[54px] text-center">
            <div className="mb-[22px] inline-flex items-center gap-2 rounded-full border border-[#374151] bg-[#1F2937] px-3.5 py-1.5">
              <span className="h-[7px] w-[7px] rounded-full bg-[#76b900]" />
              <span className="text-[12.5px] font-semibold text-[#9CA3AF]">
                Built for Australian hospitality
              </span>
            </div>
            <h1 className="mx-auto max-w-[760px] font-archivo text-[40px] font-black leading-[1.05] tracking-[-0.025em] text-white sm:text-[54px]">
              Your whole week,
              <br />
              <span className="text-[#76b900]">sorted in minutes.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-[560px] text-[16px] leading-[1.55] text-[#9CA3AF] sm:text-[17px]">
              Rostering that works as hard as your team. Build the week, track
              clock-ins, manage leave and stock — one tool, no fuss, no
              aggregator cut.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/sign-in"
                className="inline-flex items-center gap-2 rounded-[11px] bg-[#76b900] px-[26px] py-3.5 font-archivo text-[15px] font-bold text-[#111827] shadow-[0_8px_24px_rgba(118,185,0,0.28)] hover:bg-[#6aa600]"
              >
                Start free
                <span className="material-symbols-rounded text-[20px]">
                  arrow_forward
                </span>
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex items-center gap-2 rounded-[11px] border border-[#374151] bg-[#1F2937] px-[22px] py-3.5 text-[15px] font-semibold text-white hover:bg-[#283445]"
              >
                See the roster builder
              </Link>
            </div>
            <div className="mt-4 text-[12.5px] text-[#6B7280]">
              No credit card · Flat monthly fee · Cancel anytime
            </div>
          </div>
        </div>

        {/* Product mockup — browser card flush to the hero bottom. */}
        <div className="mx-auto max-w-[1140px] px-7 pt-3.5">
          <div className="overflow-hidden rounded-t-[16px] border border-b-0 border-[#E5E7EB] bg-white shadow-[0_-2px_40px_rgba(0,0,0,0.4)]">
            <div className="flex h-10 items-center gap-1.5 border-b border-[#E5E7EB] bg-[#F9FAFB] px-4">
              <span className="h-[11px] w-[11px] rounded-full bg-[#E5E7EB]" />
              <span className="h-[11px] w-[11px] rounded-full bg-[#E5E7EB]" />
              <span className="h-[11px] w-[11px] rounded-full bg-[#E5E7EB]" />
              <span className="ml-3.5 inline-flex items-center gap-1.5 text-[12px] text-[#9CA3AF]">
                <span className="material-symbols-rounded text-[14px]">
                  lock
                </span>
                roster.zaleit.com.au
              </span>
              <div className="flex-1" />
              <span className="hidden font-archivo text-[12.5px] font-bold text-[#111827] sm:inline">
                Troy&rsquo;s Kebabs · Week of 23 Jun
              </span>
            </div>
            <div className="overflow-x-auto p-4">
              <div className="min-w-[820px]">
                <div className="grid grid-cols-[150px_repeat(5,1fr)] overflow-hidden rounded-[12px] border border-[#EEF0F2]">
                  <div className="flex items-end border-b border-r border-[#EEF0F2] bg-[#FAFBFC] px-3 py-2.5 font-archivo text-[10px] font-bold uppercase tracking-[0.06em] text-[#9CA3AF]">
                    Staff
                  </div>
                  {MOCK_DAYS.map((d) => (
                    <div
                      key={d}
                      className="border-b border-r border-[#EEF0F2] bg-[#FAFBFC] px-2.5 py-2.5 font-archivo text-[12px] font-bold text-[#111827]"
                    >
                      {d}
                    </div>
                  ))}
                  {MOCK_ROWS.map((row) => (
                    <div key={row.name} className="contents">
                      <div className="flex items-center gap-2 border-b border-r border-[#EEF0F2] bg-white px-3 py-2">
                        <span
                          className="flex h-[26px] w-[26px] items-center justify-center rounded-full font-archivo text-[10.5px] font-bold text-white"
                          style={{ backgroundColor: row.color }}
                        >
                          {row.name
                            .split(" ")
                            .map((p) => p[0])
                            .join("")}
                        </span>
                        <span className="text-[12px] font-semibold text-[#111827]">
                          {row.name}
                        </span>
                      </div>
                      {row.cells.map((cell, i) => (
                        <div
                          key={i}
                          className="border-b border-r border-[#F3F4F6] bg-white p-1"
                        >
                          {cell ? (
                            <div
                              className="min-h-[46px] rounded-[6px] px-1.5 py-1.5"
                              style={{
                                backgroundColor: SHIFT[cell.k].bg,
                                borderLeft: `3px solid ${SHIFT[cell.k].bar}`,
                              }}
                            >
                              <div
                                className="font-archivo text-[11px] font-bold"
                                style={{ color: SHIFT[cell.k].label }}
                              >
                                {cell.l}
                              </div>
                              <div
                                className="mt-0.5 text-[9.5px] font-medium"
                                style={{ color: SHIFT[cell.k].time }}
                              >
                                {cell.t}
                              </div>
                            </div>
                          ) : (
                            <div className="min-h-[46px]" />
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- White body ---- */}
      <div className="bg-white">
        {/* Feature row */}
        <div id="features" className="mx-auto max-w-[1080px] px-7 pb-2.5 pt-16">
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="p-2 text-center">
                <div className="mx-auto mb-3 flex h-[46px] w-[46px] items-center justify-center rounded-[13px] bg-[#F4F8E9]">
                  <span className="material-symbols-rounded text-[24px] text-[#5A7D17]">
                    {f.icon}
                  </span>
                </div>
                <div className="font-archivo text-[14.5px] font-bold text-[#111827]">
                  {f.title}
                </div>
                <div className="mt-0.5 text-[12px] leading-[1.4] text-[#6B7280]">
                  {f.body}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Three steps */}
        <div className="mx-auto max-w-[1080px] px-7 py-[60px]">
          <div className="mb-[38px] text-center">
            <div className="font-archivo text-[12px] font-bold uppercase tracking-[0.1em] text-[#76b900]">
              How it works
            </div>
            <h2 className="mt-2.5 font-archivo text-[30px] font-extrabold tracking-[-0.02em] text-[#111827] sm:text-[34px]">
              Three steps. No manual.
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="rounded-[16px] border border-[#E5E7EB] p-[26px]"
              >
                <div className="font-archivo text-[13px] font-extrabold text-[#76b900]">
                  {s.n}
                </div>
                <div className="mb-1.5 mt-2 font-archivo text-[19px] font-bold text-[#111827]">
                  {s.title}
                </div>
                <div className="text-[14px] leading-[1.55] text-[#6B7280]">
                  {s.body}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pricing band */}
        <div id="pricing" className="bg-[#F4F8E9]">
          <div className="mx-auto max-w-[1080px] px-7 py-14">
            <div className="flex flex-wrap items-center justify-between gap-8 rounded-[22px] bg-[#111827] p-8 sm:p-11">
              <div className="max-w-[520px]">
                <h2 className="font-archivo text-[28px] font-extrabold leading-[1.15] tracking-[-0.02em] text-white sm:text-[30px]">
                  Flat monthly fee.
                  <br />
                  <span className="text-[#76b900]">
                    No per-shift charges. No aggregator cut.
                  </span>
                </h2>
                <p className="mt-4 text-[15px] leading-[1.55] text-[#9CA3AF]">
                  You run the shop, you keep the margin. One price covers your
                  whole venue — every staff member, every shift, every clock-in.
                </p>
              </div>
              <div className="min-w-[230px] flex-1 rounded-[18px] border border-[#374151] bg-[#1F2937] p-[30px] text-center">
                <div className="flex items-baseline justify-center gap-1">
                  <span className="font-archivo text-[46px] font-black text-white">
                    $49
                  </span>
                  <span className="text-[15px] font-semibold text-[#9CA3AF]">
                    /mo
                  </span>
                </div>
                <div className="mt-1 text-[12.5px] text-[#9CA3AF]">
                  flat — unlimited staff
                </div>
                <Link
                  href="/sign-in"
                  className="mt-[18px] block rounded-[11px] bg-[#76b900] py-3 font-archivo text-[14.5px] font-bold text-[#111827] hover:bg-[#6aa600]"
                >
                  Start free
                </Link>
                <div className="mt-2.5 text-[11.5px] text-[#6B7280]">
                  14-day trial · no card
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-[#111827]">
          <div className="mx-auto max-w-[1080px] px-7 pb-9 pt-12">
            <div className="flex flex-wrap justify-between gap-10">
              <div className="max-w-[300px]">
                <BrandMark size={26} />
                <div className="mt-3 text-[13px] leading-[1.6] text-[#9CA3AF]">
                  Rostering that works as hard as your team. Made in Australia
                  for cafes, kebab shops and small kitchens.
                </div>
              </div>
              <div className="flex flex-wrap gap-[54px]">
                <div>
                  <div className="mb-3 font-archivo text-[12px] font-bold uppercase tracking-[0.06em] text-white">
                    Product
                  </div>
                  <div className="flex flex-col gap-2.5 text-[13.5px] text-[#9CA3AF]">
                    <span>Rosters</span>
                    <span>Timesheets</span>
                    <span>Stock</span>
                    <a href="#pricing" className="hover:text-white">
                      Pricing
                    </a>
                  </div>
                </div>
                <div>
                  <div className="mb-3 font-archivo text-[12px] font-bold uppercase tracking-[0.06em] text-white">
                    Support
                  </div>
                  <div className="flex flex-col gap-2.5 text-[13.5px] text-[#9CA3AF]">
                    <span>Help centre</span>
                    <span>support@zaleit.com.au</span>
                    <span>Status</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-[34px] flex flex-wrap justify-between gap-4 border-t border-[#1F2937] pt-5">
              <span className="text-[12.5px] text-[#6B7280]">
                © 2026 Zaleit IT · roster.zaleit.com.au
              </span>
              <div className="flex gap-[22px] text-[12.5px] text-[#6B7280]">
                <span>Privacy</span>
                <span>Terms</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
