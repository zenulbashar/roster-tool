import { redirect } from "next/navigation";
import { auth, signIn, EMAIL_PROVIDER_ID } from "@/lib/auth";
import { Button, Card, Field, TextInput } from "@/components/ui";

export default async function SignInPage() {
  // Already signed in? Skip straight through.
  const session = await auth();
  if (session?.user) redirect("/app");

  async function sendLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    await signIn(EMAIL_PROVIDER_ID, {
      email,
      redirectTo: "/app",
    });
  }

  return (
    <main id="main" className="mx-auto max-w-md px-5 py-16">
      <h1 className="text-2xl font-bold tracking-tight">Sign in to Roster</h1>
      <p className="mt-2 text-[var(--color-muted)]">
        Enter your email and we&rsquo;ll send you a link to sign in. No password
        needed.
      </p>
      <Card className="mt-6">
        <form action={sendLink} className="space-y-4">
          <Field label="Your email">
            <TextInput
              type="email"
              name="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder="you@yourbusiness.com"
            />
          </Field>
          <Button type="submit" className="w-full">
            Email me a sign-in link
          </Button>
        </form>
      </Card>
    </main>
  );
}
