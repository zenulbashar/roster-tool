import Link from "next/link";

export default function CheckEmailPage() {
  return (
    <main
      id="main"
      className="flex min-h-screen items-center justify-center px-5 py-10"
      style={{
        backgroundImage:
          "radial-gradient(circle at 50% 0, #ECF3EE, #F9FAFB 60%)",
      }}
    >
      <div className="w-full max-w-[412px]">
        <Link
          href="/"
          className="mb-[26px] flex items-center justify-center gap-2.5"
        >
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#111827]"
          >
            <span className="material-symbols-rounded text-[20px] text-[#13301F]">
              grid_view
            </span>
          </span>
          <span className="font-archivo text-[22px] font-extrabold tracking-[0.05em] text-[#111827]">
            ROSTER
          </span>
        </Link>

        <div className="rounded-[18px] border border-[#E5E7EB] bg-white p-[30px] text-center shadow-[0_8px_30px_rgba(17,24,39,0.07)]">
          <div className="mx-auto mb-[18px] mt-1.5 flex h-[58px] w-[58px] items-center justify-center rounded-full bg-[#ECF3EE]">
            <span className="material-symbols-rounded text-[30px] text-[#2E7D4E]">
              mark_email_read
            </span>
          </div>
          <h1 className="font-archivo text-[22px] font-extrabold text-[#111827]">
            Check your email
          </h1>
          <p className="mt-2.5 text-[14px] leading-[1.55] text-[#6B7280]">
            We&rsquo;ve sent you a sign-in link. Open it on this device to
            continue — you can close this tab. The link works once and expires
            soon for your security.
          </p>
        </div>

        <div className="mt-[18px] text-center text-[12px] text-[#9CA3AF]">
          Roster by Zale IT · roster.zaleit.com.au
        </div>
      </div>
    </main>
  );
}
