import Link from "next/link";
import type { ReactNode } from "react";
import { Button, Card } from "@/components/ui";

/**
 * The ONE way a destructive action is confirmed (UX-04): a server-rendered
 * card the delete action bounces to (`?confirmDelete=<id>`) before anything is
 * removed. No native `confirm()`, no client JS — it works with the keyboard, a
 * screen reader and JS off, and because the page renders it from real data it
 * can say exactly what will go (the name, a count, the consequences).
 *
 * `action` is the same server action the first click called; on this second
 * submit it receives the hidden `confirmed=1` field and acts. The heading takes
 * focus on load so a keyboard/screen-reader user lands on the question, not on
 * the destructive button.
 */
export function ConfirmDeleteCard({
  title,
  children,
  action,
  fields,
  confirmLabel = "Delete permanently",
  cancelHref,
  cancelLabel = "Cancel",
}: {
  title: string;
  children: ReactNode;
  action: (formData: FormData) => void | Promise<void>;
  /** Hidden fields the action needs (`confirmed=1` is always added). */
  fields: Record<string, string>;
  confirmLabel?: string;
  cancelHref: string;
  cancelLabel?: string;
}) {
  return (
    <Card className="mt-4 border-[var(--color-danger)]">
      <section aria-labelledby="confirm-delete-title">
        <h2
          id="confirm-delete-title"
          tabIndex={-1}
          autoFocus
          className="font-archivo text-[17px] font-bold text-[var(--color-ink)] outline-none"
        >
          {title}
        </h2>
        <div className="mt-1 text-[13.5px] text-[var(--color-text-secondary)]">
          {children}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <form action={action}>
            {Object.entries(fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <input type="hidden" name="confirmed" value="1" />
            <Button type="submit" variant="danger">
              {confirmLabel}
            </Button>
          </form>
          <Link
            href={cancelHref}
            className="text-[13px] font-semibold text-[var(--color-text-secondary)] hover:underline"
          >
            {cancelLabel}
          </Link>
        </div>
      </section>
    </Card>
  );
}
