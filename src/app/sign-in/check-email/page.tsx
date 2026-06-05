import { Card } from "@/components/ui";

export default function CheckEmailPage() {
  return (
    <main id="main" className="mx-auto max-w-md px-5 py-16">
      <Card>
        <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
        <p className="mt-3 text-[var(--color-muted)]">
          We&rsquo;ve sent you a sign-in link. Open it on this device to
          continue. You can close this tab.
        </p>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          The link works once and expires soon for your security.
        </p>
      </Card>
    </main>
  );
}
