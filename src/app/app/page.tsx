import { PageHeader } from "@/components/ui";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Welcome"
        subtitle="You're signed in. Your roster tools will appear here."
      />
      <p className="text-[var(--color-muted)]">
        Next, you&rsquo;ll add your staff and set up the shifts you run, then
        ask everyone when they&rsquo;re free.
      </p>
    </>
  );
}
