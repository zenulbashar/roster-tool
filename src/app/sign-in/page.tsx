import Link from "next/link";
import { signIn, EMAIL_PROVIDER_ID } from "@/lib/auth";
import { redirectIfAuthenticated } from "@/lib/auth/context";
import { signInErrorMessage } from "@/lib/auth/sign-in-error";
import { Banner } from "@/components/ui";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Already signed in? Skip straight through to the dashboard.
  await redirectIfAuthenticated();

  // Auth.js redirects failures (e.g. an expired/used link) here with `?error=`.
  const { error } = await searchParams;
  const errorMessage = signInErrorMessage(error);

  async function sendLink(formData: FormData) {
    "use server";
    // Re-check server-side: a logged-out render of this form can be replayed to
    // an owner who is now signed in (router cache / bfcache / stale tab). Never
    // send a magic link to an authenticated owner — redirect them instead.
    await redirectIfAuthenticated();
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    await signIn(EMAIL_PROVIDER_ID, {
      email,
      redirectTo: "/app",
    });
  }

  return (
    <main
      id="main"
      className="flex min-h-screen items-center justify-center px-5 py-10"
      style={{
        backgroundImage:
          "radial-gradient(circle at 50% 0, #F4F8E9, #F9FAFB 60%)",
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
            <span className="material-symbols-rounded text-[20px] text-[#76b900]">
              grid_view
            </span>
          </span>
          <span className="font-archivo text-[22px] font-extrabold tracking-[0.05em] text-[#111827]">
            ROSTER
          </span>
        </Link>

        <div className="rounded-[18px] border border-[#E5E7EB] bg-white p-[30px] shadow-[0_8px_30px_rgba(17,24,39,0.07)]">
          <h1 className="text-center font-archivo text-[22px] font-extrabold text-[#111827]">
            Sign in to Roster
          </h1>
          <p className="mx-auto mt-2 text-center text-[14px] leading-[1.5] text-[#6B7280]">
            Enter your email and we&rsquo;ll send you a sign-in link. No
            password to remember.
          </p>

          {errorMessage ? (
            <div className="mt-4">
              <Banner tone="warn">{errorMessage}</Banner>
            </div>
          ) : null}

          <form action={sendLink} className="mt-6">
            <label
              htmlFor="signin-email"
              className="mb-[7px] block text-[12.5px] font-semibold text-[#374151]"
            >
              Email address
            </label>
            <input
              id="signin-email"
              type="email"
              name="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder="you@yourbusiness.com"
              className="w-full rounded-[11px] border border-[#D1D5DB] px-3.5 py-[13px] text-[14.5px] text-[#111827] outline-none focus:border-[#76b900] focus:ring-[3px] focus:ring-[rgba(118,185,0,0.16)]"
            />
            <button
              type="submit"
              className="mt-3.5 w-full rounded-[11px] bg-[#76b900] py-3.5 font-archivo text-[15px] font-bold text-[#111827] hover:bg-[#6aa600]"
            >
              Send sign-in link
            </button>
          </form>
        </div>

        <div className="mt-[18px] text-center text-[12px] text-[#9CA3AF]">
          Roster by Zaleit IT · roster.zaleit.com.au
        </div>
      </div>
    </main>
  );
}
