import Link from "next/link";
import { PageHeader, Card } from "@/components/ui";

const links = [
  {
    href: "/app/periods",
    title: "Rosters",
    body: "Create a week, ask for availability, and publish the roster.",
  },
  {
    href: "/app/staff",
    title: "Staff",
    body: "Add the people who work for you and their email addresses.",
  },
  {
    href: "/app/templates",
    title: "Shift types",
    body: "Set up the shifts you run, like Morning or Evening.",
  },
];

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Welcome" subtitle="What would you like to do?" />
      <div className="grid gap-4 sm:grid-cols-3">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="block">
            <Card className="h-full transition hover:border-[var(--color-brand)]">
              <h2 className="text-lg font-semibold text-[var(--color-ink)]">
                {l.title}
              </h2>
              <p className="mt-1 text-sm text-[var(--color-muted)]">{l.body}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
