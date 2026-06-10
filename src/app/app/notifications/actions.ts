"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";

/**
 * Owner notification actions. All tenant-scoped via `ownerRepo()` (businessId
 * from the session, never client input). `markNotificationRead` is itself
 * scoped, so a foreign id passed through the form simply no-ops.
 */

/** Only allow internal app paths as a redirect target. */
function safeLinkPath(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "/app";
  // Must be a single-slash absolute path (no protocol-relative "//host").
  if (!value.startsWith("/") || value.startsWith("//")) return "/app";
  return value;
}

/** Mark one notification read, then navigate to its link. */
export async function openNotificationAction(
  formData: FormData,
): Promise<void> {
  const id = formData.get("id");
  const repo = await ownerRepo();
  if (typeof id === "string" && id) {
    await repo.markNotificationRead(id);
  }
  revalidatePath("/app", "layout");
  redirect(safeLinkPath(formData.get("linkPath")));
}

/** Mark every unread notification for this business read. */
export async function markAllNotificationsReadAction(): Promise<void> {
  const repo = await ownerRepo();
  await repo.markAllNotificationsRead();
  revalidatePath("/app", "layout");
}
